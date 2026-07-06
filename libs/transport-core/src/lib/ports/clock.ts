/**
 * Time access is injected so span timing is deterministic in tests.
 * `monotonicMs` is used for durations (immune to wall-clock jumps),
 * `nowIso` for the span's startTime.
 */
export interface Clock {
  epochMs(): number;
  nowIso(): string;
  monotonicMs(): number;
}

export class SystemClock implements Clock {
  epochMs(): number {
    return Date.now();
  }

  nowIso(): string {
    return new Date().toISOString();
  }

  monotonicMs(): number {
    return performance.now();
  }
}
