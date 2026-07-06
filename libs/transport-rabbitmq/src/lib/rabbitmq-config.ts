export interface RabbitMqTransportConfig {
  /** AMQP connection URL, e.g. `amqp://localhost:5672`. */
  readonly url: string;
  /** Topic exchange app messages ride on. Defaults to `eventtracer`. */
  readonly exchange?: string;
  /** Per-channel unacked message cap (consumer backpressure). Defaults to 50. */
  readonly prefetch?: number;
  /** Queue name prefix. Defaults to `svc.<serviceName>` (spec §7: queue per service). */
  readonly queuePrefix?: string;
  /**
   * Queue the co-configured RabbitMqSpanSink writes span events to.
   * Defaults to `_tracing`. The transport itself never touches it — the sink
   * runs on its OWN connection (fail-safe rule).
   */
  readonly tracingQueue?: string;
  readonly requestReply?: {
    /** Default reply timeout for native request/reply. Defaults to 30s. */
    readonly timeoutMs?: number;
  };
}

export const DEFAULT_EXCHANGE = 'eventtracer';
export const DEFAULT_PREFETCH = 50;

/** Suffix for the dead-letter exchange paired with the app exchange (spec §7). */
export const DLX_SUFFIX = '.dlx';
