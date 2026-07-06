import type { SpanEvent } from '@ariadne/protocol';
import type { EmitterStats, SpanEmitter } from './span-emitter';
import { zeroStats } from './span-emitter';

/** Discards every span. For wiring tracing off without touching call sites. */
export class NoopSpanEmitter implements SpanEmitter {
  readonly stats: Readonly<EmitterStats> = zeroStats();

  emit(_span: SpanEvent): void {
    // intentionally empty
  }

  async flush(): Promise<void> {
    // intentionally empty
  }

  async close(): Promise<void> {
    // intentionally empty
  }
}
