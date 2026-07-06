import type { SpanEvent } from '@ariadne/protocol';
import { SystemClock, type Clock } from '../ports/clock';
import type { EmitterStats, SpanEmitter } from './span-emitter';
import { zeroStats } from './span-emitter';
import type { SpanSink } from './span-sink';

export interface BoundedSpanEmitterOptions {
  /** Hard cap on buffered spans; beyond it new spans are dropped. */
  readonly maxBufferSpans?: number;
  readonly maxBatchSize?: number;
  readonly flushIntervalMs?: number;
  /** Called (rate-limited) when spans are dropped. Defaults to console.warn. */
  readonly onDrop?: (droppedTotal: number, stats: Readonly<EmitterStats>) => void;
  readonly dropWarnIntervalMs?: number;
}

const DEFAULTS = {
  maxBufferSpans: 2048,
  maxBatchSize: 100,
  flushIntervalMs: 250,
  dropWarnIntervalMs: 30_000,
} as const;

/**
 * The fail-safe rule made concrete:
 * - preallocated ring buffer; `emit` is synchronous O(1) and never throws;
 * - buffer full → drop-newest (already-buffered parents are worth more than
 *   the incoming span) and count it — drops are visible, never silent;
 * - flush timer is unref'd so tracing never keeps a process alive;
 * - a failing sink drops the in-flight batch without retry (the sink owns
 *   transient retries; retrying here is how buffers explode) and never lets
 *   an error escape;
 * - `close()` makes one best-effort flush with a hard timeout, then drops.
 */
export class BoundedSpanEmitter implements SpanEmitter {
  private readonly buffer: Array<SpanEvent | undefined>;
  private readonly capacity: number;
  private readonly maxBatchSize: number;
  private readonly onDrop: (droppedTotal: number, stats: Readonly<EmitterStats>) => void;
  private readonly dropWarnIntervalMs: number;

  private head = 0;
  private tail = 0;
  private size = 0;
  private inFlight = false;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDropWarnAt = Number.NEGATIVE_INFINITY;
  private readonly _stats: EmitterStats = zeroStats();

  constructor(
    private readonly sink: SpanSink,
    options: BoundedSpanEmitterOptions = {},
    private readonly clock: Clock = new SystemClock()
  ) {
    this.capacity = options.maxBufferSpans ?? DEFAULTS.maxBufferSpans;
    this.maxBatchSize = options.maxBatchSize ?? DEFAULTS.maxBatchSize;
    this.dropWarnIntervalMs = options.dropWarnIntervalMs ?? DEFAULTS.dropWarnIntervalMs;
    if (this.capacity < 1 || this.maxBatchSize < 1) {
      throw new RangeError('maxBufferSpans and maxBatchSize must be >= 1');
    }
    this.onDrop =
      options.onDrop ??
      ((droppedTotal) =>
        console.warn(`[eventtracer] span buffer saturated — ${droppedTotal} spans dropped so far`));
    this.buffer = new Array<SpanEvent | undefined>(this.capacity);
    this.timer = setInterval(() => void this.drain(), options.flushIntervalMs ?? DEFAULTS.flushIntervalMs);
    this.timer.unref?.();
  }

  get stats(): Readonly<EmitterStats> {
    return this._stats;
  }

  emit(span: SpanEvent): void {
    if (this.closed || this.size === this.capacity) {
      this.recordDrop();
      return;
    }
    this.buffer[this.tail] = span;
    this.tail = (this.tail + 1) % this.capacity;
    this.size += 1;
    this._stats.enqueued += 1;
    if (this.size >= this.maxBatchSize) void this.drain();
  }

  async flush(): Promise<void> {
    await this.drain();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await Promise.race([
      this.drain(),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2000);
        t.unref?.();
      }),
    ]);
    this._stats.droppedSendFailure += this.size;
    this.head = 0;
    this.tail = 0;
    this.size = 0;
    this.buffer.fill(undefined);
    await this.sink.close?.().catch(() => undefined);
  }

  private recordDrop(): void {
    this._stats.droppedBufferFull += 1;
    const now = this.clock.epochMs();
    if (now - this.lastDropWarnAt >= this.dropWarnIntervalMs) {
      this.lastDropWarnAt = now;
      try {
        this.onDrop(this._stats.droppedBufferFull, this._stats);
      } catch {
        // A drop callback must never hurt the caller.
      }
    }
  }

  private takeBatch(): SpanEvent[] {
    const count = Math.min(this.size, this.maxBatchSize);
    const batch = new Array<SpanEvent>(count);
    for (let i = 0; i < count; i += 1) {
      batch[i] = this.buffer[this.head] as SpanEvent;
      this.buffer[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
    }
    this.size -= count;
    return batch;
  }

  private async drain(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      while (this.size > 0) {
        const batch = this.takeBatch();
        try {
          await this.sink.sendBatch(batch);
          this._stats.sent += batch.length;
        } catch {
          this._stats.sendFailures += 1;
          this._stats.droppedSendFailure += batch.length;
          break;
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
