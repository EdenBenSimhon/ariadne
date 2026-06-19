export enum SpanKind {
  PRODUCER = 'PRODUCER',
  CONSUMER = 'CONSUMER',
}

export enum Transport {
  KAFKA = 'kafka',
  RABBITMQ = 'rabbitmq',
  REST = 'rest',
}

export enum SpanStatus {
  OK = 'OK',
  ERROR = 'ERROR',
}

/**
 * Envelope header names (spec §3). The trace/span/parent id triple is carried via
 * the W3C `traceparent` header; the remaining fields use these `x-*` headers.
 */
export const TRACE_HEADERS = {
  traceParent: 'traceparent',
  traceId: 'x-trace-id',
  spanId: 'x-span-id',
  parentSpanId: 'x-parent-span-id',
  serviceName: 'x-service-name',
  correlationId: 'x-correlation-id',
  tenantId: 'x-tenant-id',
} as const;

/** The dedicated channel every adapter publishes span events to (spec §3, §8). */
export const TRACING_CHANNEL = '_tracing';
