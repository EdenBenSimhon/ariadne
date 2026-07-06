/** A transport was asked for a capability it declares as 'none' (spec §4: fail loudly at wiring time). */
export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityError';
  }
}

/** Invalid transport wiring, e.g. subscribing after the consumer already started. */
export class TransportWiringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportWiringError';
  }
}

/** A request/reply call did not receive its reply within the timeout. */
export class RequestTimeoutError extends Error {
  constructor(target: string, timeoutMs: number) {
    super(`request to '${target}' timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
  }
}
