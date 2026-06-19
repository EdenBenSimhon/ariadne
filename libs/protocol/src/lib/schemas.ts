import { z } from 'zod';
import { SpanKind, SpanStatus, Transport } from './constants';

/**
 * Trace context (spec §3) — the propagated identity of one operation in a flow.
 * `tenantId` is carried from the first hop (multi-tenancy from day one).
 */
export const TraceContextSchema = z.object({
  traceId: z.string().uuid(),
  spanId: z.string().uuid(),
  parentSpanId: z.string().uuid().nullable(),
  serviceName: z.string().min(1),
  tenantId: z.string().min(1),
  correlationId: z.string().min(1).optional(),
});
export type TraceContext = z.infer<typeof TraceContextSchema>;

/**
 * Span event (spec §3) — what every adapter emits to `_tracing`.
 * The `parentSpanId` chain is what stitches services into one trace.
 */
export const SpanEventSchema = z.object({
  traceId: z.string().uuid(),
  spanId: z.string().uuid(),
  parentSpanId: z.string().uuid().nullable(),
  tenantId: z.string().min(1),
  serviceName: z.string().min(1),
  spanKind: z.enum(SpanKind),
  transport: z.enum(Transport),
  channel: z.string().min(1),
  operationName: z.string().min(1),
  startTime: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  status: z.enum(SpanStatus),
  error: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type SpanEvent = z.infer<typeof SpanEventSchema>;

/**
 * Envelope (spec §2–3) — the transport-neutral message: trace headers + the
 * untouched business payload + optional correlation for request/reply.
 */
export const EnvelopeSchema = z.object({
  headers: z.record(z.string(), z.string()),
  payload: z.unknown(),
  correlationId: z.string().min(1).optional(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;
