import { HEADERS, formatTraceparent, type SpanEvent } from '@ariadne/protocol';
import {
  RequestTimeoutError,
  TransportWiringError,
  type TransportRuntime,
} from '@ariadne/transport-core';
import {
  CapturingEmitter,
  SequentialIdGenerator,
  makeTestRuntime,
} from '@ariadne/transport-core/testing';
import { Kafka } from 'kafkajs';
import { KafkaSpanSink } from './kafka-span-sink';
import { KafkaTransport } from './kafka-transport';

jest.mock('kafkajs', () => {
  class MockProducer {
    connect = jest.fn(async () => undefined);
    disconnect = jest.fn(async () => undefined);
    send = jest.fn(async () => []);
  }

  class MockConsumer {
    eachMessage: ((payload: unknown) => Promise<void>) | null = null;
    subscribedTopics: string[] = [];
    connect = jest.fn(async () => undefined);
    disconnect = jest.fn(async () => undefined);
    subscribe = jest.fn(async (opts: { topic: string }) => {
      this.subscribedTopics.push(opts.topic);
    });
    run = jest.fn(async (opts: { eachMessage: (payload: unknown) => Promise<void> }) => {
      this.eachMessage = opts.eachMessage;
    });

    constructor(readonly config: { groupId: string }) {}
  }

  class MockKafka {
    static instances: MockKafka[] = [];
    producers: MockProducer[] = [];
    consumers: MockConsumer[] = [];

    constructor(readonly config: { clientId: string }) {
      MockKafka.instances.push(this);
    }

    producer() {
      const producer = new MockProducer();
      this.producers.push(producer);
      return producer;
    }

    consumer(config: { groupId: string }) {
      const consumer = new MockConsumer(config);
      this.consumers.push(consumer);
      return consumer;
    }
  }

  return { Kafka: MockKafka };
});

interface MockProducer {
  connect: jest.Mock;
  disconnect: jest.Mock;
  send: jest.Mock;
}

interface MockConsumer {
  eachMessage: ((payload: unknown) => Promise<void>) | null;
  subscribedTopics: string[];
  connect: jest.Mock;
  disconnect: jest.Mock;
  subscribe: jest.Mock;
  run: jest.Mock;
  config: { groupId: string };
}

interface MockKafkaStatic {
  instances: Array<{
    config: { clientId: string };
    producers: MockProducer[];
    consumers: MockConsumer[];
  }>;
}

const MockKafka = Kafka as unknown as MockKafkaStatic;

function makeMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: null,
    value: Buffer.from(JSON.stringify({ orderId: 'ord-1' })),
    headers: {},
    offset: '0',
    timestamp: '0',
    attributes: 0,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('KafkaTransport', () => {
  let emitter: CapturingEmitter;
  let runtime: TransportRuntime;
  let transport: KafkaTransport;

  beforeEach(() => {
    MockKafka.instances.length = 0;
    emitter = new CapturingEmitter();
    runtime = makeTestRuntime({ emitter, serviceName: 'order-service' });
    transport = new KafkaTransport(runtime, { brokers: ['broker:9092'] });
  });

  const kafka = () => MockKafka.instances[0]!;
  const producer = () => kafka().producers[0]!;
  const groupConsumer = () => kafka().consumers[0]!;

  it('publishes with trace headers, payload JSON and the partition key', async () => {
    await transport.connect();
    await transport.publish({
      channel: 'orders.created',
      headers: {},
      payload: { orderId: 'ord-1' },
      key: 'ord-1',
    });

    const record = producer().send.mock.calls[0]?.[0];
    expect(record.topic).toBe('orders.created');
    expect(record.messages[0].key).toBe('ord-1');
    expect(record.messages[0].value).toBe(JSON.stringify({ orderId: 'ord-1' }));
    const span = emitter.spans[0] as SpanEvent;
    expect(record.messages[0].headers[HEADERS.TRACEPARENT]).toBe(
      formatTraceparent(span.traceId, span.spanId)
    );
    expect(record.messages[0].headers[HEADERS.TENANT_ID]).toBe('acme');
  });

  it('uses a consumer group per service and dispatches inbound messages through the tracing wrapper', async () => {
    const seen: unknown[] = [];
    transport.subscribe('orders.created', (envelope) => {
      seen.push(envelope.payload);
    });
    await transport.connect();

    expect(groupConsumer().config.groupId).toBe('svc.order-service');
    expect(groupConsumer().subscribedTopics).toEqual(['orders.created']);

    const ids = new SequentialIdGenerator();
    const traceId = ids.newTraceId();
    const parentSpanId = ids.newSpanId();
    await groupConsumer().eachMessage?.({
      topic: 'orders.created',
      partition: 3,
      message: makeMessage({
        headers: { [HEADERS.TRACEPARENT]: formatTraceparent(traceId, parentSpanId) },
      }),
    });

    expect(seen).toEqual([{ orderId: 'ord-1' }]);
    const span = emitter.spans[0];
    expect(span?.spanKind).toBe('CONSUMER');
    expect(span?.traceId).toBe(traceId);
    expect(span?.parentSpanId).toBe(parentSpanId);
  });

  it('routes a failing message to the DLQ with the original content and commits', async () => {
    transport.subscribe('orders.created', () => {
      throw new Error('poison');
    });
    await transport.connect();

    await expect(
      groupConsumer().eachMessage?.({
        topic: 'orders.created',
        partition: 0,
        message: makeMessage(),
      })
    ).resolves.toBeUndefined();

    const dlqRecord = producer().send.mock.calls[0]?.[0];
    expect(dlqRecord.topic).toBe('orders.created.dlq');
    expect(dlqRecord.messages[0].headers['x-dlq-error']).toBe('Error: poison');
    expect(dlqRecord.messages[0].headers['x-dlq-source-topic']).toBe('orders.created');
    expect(emitter.spans[0]?.status).toBe('ERROR');
  });

  it('rethrows the original error when the DLQ publish fails (at-least-once redelivery)', async () => {
    transport.subscribe('orders.created', () => {
      throw new Error('poison');
    });
    await transport.connect();
    producer().send.mockRejectedValueOnce(new Error('dlq down'));

    await expect(
      groupConsumer().eachMessage?.({
        topic: 'orders.created',
        partition: 0,
        message: makeMessage(),
      })
    ).rejects.toThrow('poison');
  });

  it('fails loudly when subscribing after connect()', async () => {
    transport.subscribe('orders.created', () => undefined);
    await transport.connect();
    expect(() => transport.subscribe('other.topic', () => undefined)).toThrow(
      TransportWiringError
    );
  });

  it('emulates request/reply via a per-instance reply topic and correlation id', async () => {
    await transport.connect();
    const pending = transport.request('inventory.check', {
      channel: 'inventory.check',
      headers: {},
      payload: { sku: 'sku-1' },
    });
    await settle();

    const replyConsumer = kafka().consumers[1]!;
    expect(replyConsumer.subscribedTopics[0]).toMatch(/^order-service\.reply\.[0-9a-f]{16}$/);

    const record = producer().send.mock.calls[0]?.[0];
    expect(record.topic).toBe('inventory.check');
    const sentHeaders = record.messages[0].headers as Record<string, string>;
    const correlationId = sentHeaders[HEADERS.CORRELATION_ID];
    expect(correlationId).toMatch(/^[0-9a-f]{16}$/);
    expect(sentHeaders['x-reply-to']).toBe(replyConsumer.subscribedTopics[0]);

    await replyConsumer.eachMessage?.({
      topic: replyConsumer.subscribedTopics[0],
      partition: 0,
      message: makeMessage({
        value: Buffer.from(JSON.stringify({ available: true })),
        headers: { [HEADERS.CORRELATION_ID]: correlationId },
      }),
    });

    const reply = await pending;
    expect(reply.payload).toEqual({ available: true });
    expect(emitter.spans[0]?.spanKind).toBe('PRODUCER');
    expect(emitter.spans[0]?.status).toBe('OK');
  });

  it('rejects a request that receives no reply within the timeout', async () => {
    await transport.connect();
    await expect(
      transport.request(
        'inventory.check',
        { channel: 'inventory.check', headers: {}, payload: {} },
        { timeoutMs: 10 }
      )
    ).rejects.toThrow(RequestTimeoutError);
    expect(emitter.spans[0]?.status).toBe('ERROR');
  });
});

describe('KafkaSpanSink', () => {
  beforeEach(() => {
    MockKafka.instances.length = 0;
  });

  it('runs on its own Kafka client, separate from any app client', async () => {
    const runtime = makeTestRuntime({ serviceName: 'order-service' });
    void new KafkaTransport(runtime, { brokers: ['broker:9092'] });
    const sink = new KafkaSpanSink({ brokers: ['broker:9092'], clientId: 'order-service' });

    expect(MockKafka.instances).toHaveLength(2);
    expect(MockKafka.instances[1]?.config.clientId).toBe('order-service-tracing');

    const span = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
    } as unknown as Parameters<typeof sink.sendBatch>[0][number];
    await sink.sendBatch([span]);

    const tracingProducer = MockKafka.instances[1]?.producers[0];
    const record = tracingProducer?.send.mock.calls[0]?.[0];
    expect(record.topic).toBe('_tracing');
    expect(record.acks).toBe(1);
    expect(record.messages[0].key).toBe('a'.repeat(32));
    expect(JSON.parse(record.messages[0].value)).toMatchObject({ spanId: 'b'.repeat(16) });
  });
});
