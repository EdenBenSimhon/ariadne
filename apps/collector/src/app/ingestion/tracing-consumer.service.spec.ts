import type { SpanEvent } from '@ariadne/protocol';
import type { InsertResult, TraceStore } from '@ariadne/storage';
import type { EachBatchPayload } from 'kafkajs';
import { loadCollectorConfig, type CollectorConfig } from '../config/collector-config';
import { IngestionMetrics } from './ingestion-metrics';
import { isTransientDbError, TracingConsumerService } from './tracing-consumer.service';

jest.mock('kafkajs', () => {
  class MockConsumer {
    runConfig: { eachBatchAutoResolve?: boolean; eachBatch?: unknown } | null = null;
    subscriptions: unknown[] = [];
    events = { CRASH: 'consumer.crash' };
    on = jest.fn();
    connect = jest.fn(async () => undefined);
    disconnect = jest.fn(async () => undefined);
    stop = jest.fn(async () => undefined);
    subscribe = jest.fn(async (opts: unknown) => {
      this.subscriptions.push(opts);
    });
    run = jest.fn(async (config: { eachBatchAutoResolve?: boolean; eachBatch?: unknown }) => {
      this.runConfig = config;
    });

    constructor(readonly config: { groupId: string; maxWaitTimeInMs?: number; minBytes?: number }) {}
  }

  class MockKafka {
    static consumers: MockConsumer[] = [];
    constructor(readonly config: unknown) {}
    consumer(config: { groupId: string }) {
      const consumer = new MockConsumer(config);
      MockKafka.consumers.push(consumer);
      return consumer;
    }
  }

  return { Kafka: MockKafka };
});

import { Kafka } from 'kafkajs';

interface MockConsumerShape {
  runConfig: { eachBatchAutoResolve?: boolean } | null;
  subscriptions: Array<{ topic: string; fromBeginning: boolean }>;
  config: { groupId: string; maxWaitTimeInMs?: number; minBytes?: number };
  stop: jest.Mock;
  disconnect: jest.Mock;
}

const MockKafka = Kafka as unknown as { consumers: MockConsumerShape[] };

let seq = 0;
function spanJson(): string {
  seq += 1;
  return JSON.stringify({
    traceId: 'f'.repeat(32),
    spanId: seq.toString(16).padStart(16, '0'),
    parentSpanId: null,
    tenantId: 'acme',
    serviceName: 'order-service',
    spanKind: 'PRODUCER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: 'publish orders.created',
    startTime: new Date(Date.now() - 1000).toISOString(),
    durationMs: 10,
    status: 'OK',
    error: null,
    metadata: null,
  });
}

function makeConfig(overrides: Partial<CollectorConfig> = {}): CollectorConfig {
  return { ...loadCollectorConfig({}), batchMaxSpans: 2, dbRetryAttempts: 3, ...overrides };
}

function okStore(): TraceStore & { insertSpans: jest.Mock } {
  return {
    insertSpans: jest.fn(
      async (spans: readonly SpanEvent[]): Promise<InsertResult> => ({
        received: spans.length,
        inserted: spans.length,
        duplicates: 0,
      })
    ),
    ping: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
}

function makePayload(values: Array<string | null>): EachBatchPayload & {
  resolveOffset: jest.Mock;
  heartbeat: jest.Mock;
} {
  return {
    batch: {
      messages: values.map((value, i) => ({
        offset: String(i),
        value: value === null ? null : Buffer.from(value),
      })),
    },
    resolveOffset: jest.fn(),
    heartbeat: jest.fn(async () => undefined),
    isRunning: () => true,
    isStale: () => false,
  } as unknown as EachBatchPayload & { resolveOffset: jest.Mock; heartbeat: jest.Mock };
}

function makeService(config: CollectorConfig, store: TraceStore) {
  const metrics = new IngestionMetrics();
  const service = new TracingConsumerService(config, store, metrics);
  return { service, metrics };
}

describe('TracingConsumerService', () => {
  beforeEach(() => {
    MockKafka.consumers.length = 0;
  });

  it('subscribes to _tracing with the collector group and manual offset resolution', async () => {
    const { service } = makeService(makeConfig(), okStore());
    await service.onApplicationBootstrap();

    const consumer = MockKafka.consumers[0]!;
    expect(consumer.config.groupId).toBe('eventtracer-collector-group');
    expect(consumer.config.maxWaitTimeInMs).toBe(500);
    expect(consumer.subscriptions[0]).toEqual({ topic: '_tracing', fromBeginning: true });
    expect(consumer.runConfig?.eachBatchAutoResolve).toBe(false);
    expect(service.isRunning).toBe(true);

    await service.onModuleDestroy();
    expect(consumer.stop).toHaveBeenCalled();
    expect(consumer.disconnect).toHaveBeenCalled();
  });

  it('writes chunks and resolves offsets only after each write commits', async () => {
    const store = okStore();
    const { service, metrics } = makeService(makeConfig(), store);
    const payload = makePayload([spanJson(), spanJson(), spanJson(), 'garbage']);

    await service.handleBatch(payload);

    // batchMaxSpans=2 → chunk[0]=2 spans (offset 1), chunk[1]=1 span (offset 3 = last), final offset 3.
    expect(store.insertSpans).toHaveBeenCalledTimes(2);
    expect(payload.resolveOffset.mock.calls.map((c) => c[0])).toEqual(['1', '3', '3']);
    expect(payload.heartbeat).toHaveBeenCalled();
    expect(metrics.snapshot().spansIngested).toBe(3);
    expect(metrics.snapshot().spansInvalid).toBe(1);
  });

  it('retries transient DB errors with heartbeats, then succeeds', async () => {
    const store = okStore();
    store.insertSpans
      .mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'ECONNREFUSED' }))
      .mockRejectedValueOnce(Object.assign(new Error('down'), { code: '08006' }));
    const { service, metrics } = makeService(makeConfig(), store);
    const payload = makePayload([spanJson()]);

    await service.handleBatch(payload);

    expect(store.insertSpans).toHaveBeenCalledTimes(3);
    expect(metrics.snapshot().dbRetries).toBe(2);
    expect(payload.resolveOffset).toHaveBeenCalled();
  }, 15_000);

  it('rethrows after exhausting retries and does NOT resolve the offset (redelivery)', async () => {
    const store = okStore();
    store.insertSpans.mockRejectedValue(
      Object.assign(new Error('still down'), { code: 'ECONNREFUSED' })
    );
    const { service } = makeService(makeConfig({ dbRetryAttempts: 2 }), store);
    const payload = makePayload([spanJson()]);

    await expect(service.handleBatch(payload)).rejects.toThrow('still down');
    expect(payload.resolveOffset).not.toHaveBeenCalled();
  }, 15_000);

  it('falls back to row-by-row on permanent errors so one poison span cannot wedge the batch', async () => {
    const store = okStore();
    const poison = Object.assign(new Error('value too long'), { code: '22001' });
    store.insertSpans.mockImplementation(async (spans: readonly SpanEvent[]) => {
      if (spans.length > 1) throw poison;
      if (spans[0]?.channel === 'orders.created' && spans[0].spanId.endsWith('1')) throw poison;
      return { received: spans.length, inserted: spans.length, duplicates: 0 };
    });
    seq = 0; // first span of this test gets spanId …0001 → the poison row
    const { service, metrics } = makeService(makeConfig(), store);
    const payload = makePayload([spanJson(), spanJson()]);

    await service.handleBatch(payload);

    expect(metrics.snapshot().rowFallbackFailures).toBe(1);
    expect(metrics.snapshot().spansIngested).toBe(1);
    expect(payload.resolveOffset).toHaveBeenCalled();
  });

  it('aborts remaining chunks when the batch goes stale', async () => {
    const store = okStore();
    const { service } = makeService(makeConfig(), store);
    const payload = makePayload([spanJson(), spanJson(), spanJson()]);
    let calls = 0;
    (payload as { isStale: () => boolean }).isStale = () => {
      calls += 1;
      return calls > 1; // first chunk proceeds, second sees stale
    };

    await service.handleBatch(payload);

    expect(store.insertSpans).toHaveBeenCalledTimes(1);
    expect(payload.resolveOffset).toHaveBeenCalledTimes(1);
  });
});

describe('isTransientDbError', () => {
  it.each([
    ['ECONNREFUSED', true],
    ['08006', true],
    ['53300', true],
    ['57P01', true],
    ['40001', true],
    ['40P01', true],
    ['22001', false],
    ['23505', false],
    ['42501', false],
  ])('classifies %s as transient=%s', (code, expected) => {
    expect(isTransientDbError(Object.assign(new Error('x'), { code }))).toBe(expected);
  });

  it('treats unknown shapes as permanent', () => {
    expect(isTransientDbError(new Error('no code'))).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError('string')).toBe(false);
  });
});
