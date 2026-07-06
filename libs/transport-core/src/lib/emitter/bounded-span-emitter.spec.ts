import type { SpanEvent } from '@ariadne/protocol';
import { tenantIdSchema } from '@ariadne/protocol';
import { ManualClock } from '../../testing/manual-clock';
import { SequentialIdGenerator } from '../../testing/sequential-ids';
import { BoundedSpanEmitter } from './bounded-span-emitter';
import type { SpanSink } from './span-sink';

const ids = new SequentialIdGenerator();

function makeSpan(): SpanEvent {
  return {
    traceId: ids.newTraceId(),
    spanId: ids.newSpanId(),
    parentSpanId: null,
    tenantId: tenantIdSchema.parse('acme'),
    serviceName: 'svc-test',
    spanKind: 'PRODUCER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: 'publish orders.created',
    startTime: '2026-05-31T10:00:00.000Z',
    durationMs: 1,
    status: 'OK',
    error: null,
    metadata: null,
  };
}

function collectingSink(): SpanSink & { batches: SpanEvent[][] } {
  const batches: SpanEvent[][] = [];
  return {
    batches,
    async sendBatch(spans) {
      batches.push([...spans]);
    },
  };
}

describe('BoundedSpanEmitter', () => {
  it('drops newest when the buffer is full, without blocking or throwing', () => {
    const sink: SpanSink = { sendBatch: () => new Promise(() => undefined) };
    const emitter = new BoundedSpanEmitter(
      sink,
      { maxBufferSpans: 2, maxBatchSize: 100, flushIntervalMs: 60_000, onDrop: () => undefined },
      new ManualClock()
    );

    for (let i = 0; i < 5; i += 1) emitter.emit(makeSpan());

    expect(emitter.stats.enqueued).toBe(2);
    expect(emitter.stats.droppedBufferFull).toBe(3);
  });

  it('drops a batch when the sink rejects, keeps counters, and recovers on the next flush', async () => {
    let failNext = true;
    const sent: SpanEvent[][] = [];
    const sink: SpanSink = {
      async sendBatch(spans) {
        if (failNext) {
          failNext = false;
          throw new Error('broker down');
        }
        sent.push([...spans]);
      },
    };
    const emitter = new BoundedSpanEmitter(
      sink,
      { maxBufferSpans: 10, maxBatchSize: 100, flushIntervalMs: 60_000, onDrop: () => undefined },
      new ManualClock()
    );

    emitter.emit(makeSpan());
    emitter.emit(makeSpan());
    await emitter.flush();
    expect(emitter.stats.sendFailures).toBe(1);
    expect(emitter.stats.droppedSendFailure).toBe(2);

    emitter.emit(makeSpan());
    await emitter.flush();
    expect(emitter.stats.sent).toBe(1);
    expect(sent).toHaveLength(1);
    await emitter.close();
  });

  it('flushes automatically when the buffer reaches the batch size', async () => {
    const sink = collectingSink();
    const emitter = new BoundedSpanEmitter(
      sink,
      { maxBufferSpans: 10, maxBatchSize: 2, flushIntervalMs: 60_000 },
      new ManualClock()
    );

    emitter.emit(makeSpan());
    expect(sink.batches).toHaveLength(0);
    emitter.emit(makeSpan());
    await emitter.flush();

    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0]).toHaveLength(2);
    expect(emitter.stats.sent).toBe(2);
    await emitter.close();
  });

  it('close() flushes what it can and refuses further spans', async () => {
    const sink = collectingSink();
    const emitter = new BoundedSpanEmitter(
      sink,
      { maxBufferSpans: 10, maxBatchSize: 100, flushIntervalMs: 60_000, onDrop: () => undefined },
      new ManualClock()
    );

    emitter.emit(makeSpan());
    await emitter.close();
    expect(emitter.stats.sent).toBe(1);

    emitter.emit(makeSpan());
    expect(emitter.stats.droppedBufferFull).toBe(1);
  });

  it('rate-limits the drop warning callback', () => {
    const clock = new ManualClock();
    const warnings: number[] = [];
    const sink: SpanSink = { sendBatch: () => new Promise(() => undefined) };
    const emitter = new BoundedSpanEmitter(
      sink,
      {
        maxBufferSpans: 1,
        maxBatchSize: 100,
        flushIntervalMs: 60_000,
        dropWarnIntervalMs: 30_000,
        onDrop: (total) => warnings.push(total),
      },
      clock
    );

    emitter.emit(makeSpan());
    emitter.emit(makeSpan());
    emitter.emit(makeSpan());
    expect(warnings).toEqual([1]);

    clock.advance(30_000);
    emitter.emit(makeSpan());
    expect(warnings).toEqual([1, 3]);
  });
});
