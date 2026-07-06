import { z } from 'zod';
import { LIMITS } from '../constants';

/**
 * IDs are W3C trace-context native: trace-id = 16 random bytes (32 hex),
 * span-id = 8 random bytes (16 hex). A UUID cannot fit a W3C span-id, so the
 * protocol uses hex ids everywhere instead of RFC-4122 strings.
 *
 * TraceId / SpanId / TenantId are branded — assigning one where another is
 * expected is a compile error, at zero runtime cost.
 */
export const TRACE_ID_REGEX = /^[0-9a-f]{32}$/;
export const SPAN_ID_REGEX = /^[0-9a-f]{16}$/;

const ALL_ZERO_TRACE_ID = '0'.repeat(32);
const ALL_ZERO_SPAN_ID = '0'.repeat(16);

export const traceIdSchema = z
  .string()
  .regex(TRACE_ID_REGEX, 'traceId must be 32 lowercase hex chars')
  .refine((v) => v !== ALL_ZERO_TRACE_ID, 'traceId must not be all-zero')
  .brand<'TraceId'>();
export type TraceId = z.infer<typeof traceIdSchema>;

export const spanIdSchema = z
  .string()
  .regex(SPAN_ID_REGEX, 'spanId must be 16 lowercase hex chars')
  .refine((v) => v !== ALL_ZERO_SPAN_ID, 'spanId must not be all-zero')
  .brand<'SpanId'>();
export type SpanId = z.infer<typeof spanIdSchema>;

/** Safe as a database key component: lowercase, no path/SQL/glob metacharacters. */
export const tenantIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'tenantId must be lowercase alphanumeric with . _ -')
  .brand<'TenantId'>();
export type TenantId = z.infer<typeof tenantIdSchema>;

/** Printable ASCII without spaces — travels verbatim in message headers. */
const HEADER_SAFE_REGEX = /^[\x21-\x7e]+$/;

export const serviceNameSchema = z
  .string()
  .min(1)
  .max(LIMITS.SERVICE_NAME_MAX_LEN)
  .regex(HEADER_SAFE_REGEX, 'serviceName must be printable ASCII without spaces');
export type ServiceName = z.infer<typeof serviceNameSchema>;

/** Topic / routing key / route — the transport-neutral "channel" (spec §3). */
export const channelSchema = z
  .string()
  .min(1)
  .max(LIMITS.CHANNEL_MAX_LEN)
  .regex(HEADER_SAFE_REGEX, 'channel must be printable ASCII without spaces');
export type Channel = z.infer<typeof channelSchema>;

export const operationNameSchema = z.string().min(1).max(LIMITS.OPERATION_NAME_MAX_LEN);

export const correlationIdSchema = z
  .string()
  .min(1)
  .max(LIMITS.CORRELATION_ID_MAX_LEN)
  .regex(HEADER_SAFE_REGEX, 'correlationId must be printable ASCII without spaces');

export const spanKindSchema = z.enum(['PRODUCER', 'CONSUMER']);
export type SpanKind = z.infer<typeof spanKindSchema>;

export const transportKindSchema = z.enum(['kafka', 'rabbitmq', 'rest']);
export type TransportKind = z.infer<typeof transportKindSchema>;

export const spanStatusSchema = z.enum(['OK', 'ERROR']);
export type SpanStatus = z.infer<typeof spanStatusSchema>;

/**
 * Metadata is flat primitives only — a deliberate security posture (B1/B4):
 * nothing nested can be smuggled through metadata toward storage or the
 * future agent. Values are size-capped; the key count is bounded.
 */
export const metadataValueSchema = z.union([
  z.string().max(LIMITS.METADATA_MAX_VALUE_LEN),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type MetadataValue = z.infer<typeof metadataValueSchema>;

export const metadataSchema = z
  .record(z.string().min(1).max(LIMITS.METADATA_KEY_MAX_LEN), metadataValueSchema)
  .refine(
    (m) => Object.keys(m).length <= LIMITS.METADATA_MAX_KEYS,
    `metadata is limited to ${LIMITS.METADATA_MAX_KEYS} keys`
  );
export type Metadata = z.infer<typeof metadataSchema>;
