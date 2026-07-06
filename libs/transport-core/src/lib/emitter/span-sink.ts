import type { SpanEvent } from '@ariadne/protocol';

/**
 * Where batches of spans go — the seam between the fail-safe emitter and the
 * wire. The Kafka implementation wraps a dedicated tracing producer on a
 * separate client (never the app producer); a future OTLP/HTTP exporter is
 * another implementation of this interface.
 */
export interface SpanSink {
  sendBatch(spans: readonly SpanEvent[]): Promise<void>;
  close?(): Promise<void>;
}
