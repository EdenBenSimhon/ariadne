import type { Clock } from '../lib/ports/clock';

/** Deterministic clock — advance time explicitly in tests. */
export class ManualClock implements Clock {
  private epoch: number;
  private mono = 0;

  constructor(startEpochMs = 1_750_000_000_000) {
    this.epoch = startEpochMs;
  }

  advance(ms: number): void {
    this.epoch += ms;
    this.mono += ms;
  }

  epochMs(): number {
    return this.epoch;
  }

  nowIso(): string {
    return new Date(this.epoch).toISOString();
  }

  monotonicMs(): number {
    return this.mono;
  }
}
