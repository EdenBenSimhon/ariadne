import type { SpanEvent } from '@ariadne/protocol';
import type { EmitterStats, SpanEmitter } from '../lib/emitter/span-emitter';
import { zeroStats } from '../lib/emitter/span-emitter';

/** Collects every emitted span synchronously for assertions. */
export class CapturingEmitter implements SpanEmitter {
  readonly spans: SpanEvent[] = [];
  private readonly _stats: EmitterStats = zeroStats();

  get stats(): Readonly<EmitterStats> {
    return this._stats;
  }

  emit(span: SpanEvent): void {
    this.spans.push(span);
    this._stats.enqueued += 1;
    this._stats.sent += 1;
  }

  async flush(): Promise<void> {
    // synchronous capture — nothing to flush
  }

  async close(): Promise<void> {
    // nothing to release
  }
}
