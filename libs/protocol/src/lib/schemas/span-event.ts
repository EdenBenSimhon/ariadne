import { z } from 'zod';
import { LIMITS } from '../constants';
import {
  channelSchema,
  metadataSchema,
  operationNameSchema,
  serviceNameSchema,
  spanIdSchema,
  spanKindSchema,
  spanStatusSchema,
  tenantIdSchema,
  traceIdSchema,
  transportKindSchema,
} from './primitives';

/**
 * The span event published to `_tracing` (spec §3).
 *
 * Strict object: unknown keys are rejected. Span events cross the trusted
 * ingestion boundary (security B1/B2), so the collector validates with this
 * exact schema — extra fields cannot ride along into storage.
 */
export const spanEventSchema = z
  .strictObject({
    traceId: traceIdSchema,
    spanId: spanIdSchema,
    /** null = root span of the trace. */
    parentSpanId: spanIdSchema.nullable(),
    tenantId: tenantIdSchema,
    serviceName: serviceNameSchema,
    spanKind: spanKindSchema,
    transport: transportKindSchema,
    channel: channelSchema,
    operationName: operationNameSchema,
    startTime: z.iso.datetime(),
    durationMs: z.number().int().nonnegative().max(LIMITS.DURATION_MAX_MS),
    status: spanStatusSchema,
    error: z.string().max(LIMITS.ERROR_MAX_LEN).nullable(),
    /** Allowlist-redacted at source (security B1); flat primitives only. */
    metadata: metadataSchema.nullable(),
  })
  .refine((s) => (s.status === 'ERROR') === (s.error !== null), {
    message: "error must be set exactly when status is 'ERROR'",
    path: ['error'],
  });

export type SpanEvent = z.infer<typeof spanEventSchema>;

/** Validate an untrusted payload from `_tracing`. Never throws. */
export function parseSpanEvent(input: unknown): z.ZodSafeParseResult<SpanEvent> {
  return spanEventSchema.safeParse(input);
}
