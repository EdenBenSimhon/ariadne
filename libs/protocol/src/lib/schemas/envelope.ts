import { z } from 'zod';
import {
  correlationIdSchema,
  serviceNameSchema,
  spanIdSchema,
  tenantIdSchema,
  traceIdSchema,
} from './primitives';

/**
 * The in-process representation of trace context. Headers are only a codec
 * for this object (see traceparent.ts) — code never passes raw headers around.
 */
export const traceContextSchema = z.strictObject({
  traceId: traceIdSchema,
  spanId: spanIdSchema,
  /** null = this operation is the trace root. */
  parentSpanId: spanIdSchema.nullable(),
  tenantId: tenantIdSchema,
  serviceName: serviceNameSchema,
  correlationId: correlationIdSchema.nullable(),
});
export type TraceContext = z.infer<typeof traceContextSchema>;

/**
 * The transport-neutral message shape (spec §3): headers carry trace metadata,
 * the business payload is opaque and never modified by the tracing layer.
 */
export interface Envelope {
  /** Topic / routing key / route. */
  readonly channel: string;
  readonly headers: Readonly<Record<string, string>>;
  /** Business payload — opaque to the protocol, never touched. */
  readonly payload: unknown;
  /** Optional partition/ordering key (e.g. an entity id such as orderId). */
  readonly key?: string;
}
