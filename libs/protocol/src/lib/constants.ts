/**
 * Layer 1 — Tracing Protocol (spec §3).
 * Transport- and framework-neutral constants. This file must stay free of
 * Node-only and framework imports so the browser (Angular UI) can consume it.
 */

/** Envelope header names, carried over Kafka record.headers, AMQP properties.headers and HTTP headers. */
export const HEADERS = {
  /** W3C canonical wire format: `00-{traceId}-{spanId}-{flags}` — preferred on read. */
  TRACEPARENT: 'traceparent',
  TRACE_ID: 'x-trace-id',
  SPAN_ID: 'x-span-id',
  PARENT_SPAN_ID: 'x-parent-span-id',
  SERVICE_NAME: 'x-service-name',
  CORRELATION_ID: 'x-correlation-id',
  TENANT_ID: 'x-tenant-id',
} as const;

export type HeaderName = (typeof HEADERS)[keyof typeof HEADERS];

/** The tracing channel every adapter publishes span events to (spec §2). */
export const TRACING_CHANNEL = '_tracing';

/** Suffix for dead-letter channels (spec §7). */
export const DLQ_SUFFIX = '.dlq';

/**
 * Input bounds enforced at the ingestion boundary (security B1/B2).
 * Span events are untrusted input — every free-form field is capped.
 */
export const LIMITS = {
  METADATA_MAX_KEYS: 32,
  METADATA_KEY_MAX_LEN: 64,
  METADATA_MAX_VALUE_LEN: 256,
  ERROR_MAX_LEN: 1024,
  SERVICE_NAME_MAX_LEN: 128,
  CHANNEL_MAX_LEN: 256,
  OPERATION_NAME_MAX_LEN: 256,
  CORRELATION_ID_MAX_LEN: 128,
  /** Spans longer than 24h are treated as corrupt input. */
  DURATION_MAX_MS: 86_400_000,
} as const;
