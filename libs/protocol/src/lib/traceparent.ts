import { HEADERS } from './constants';
import type { TraceContext } from './schemas/envelope';
import {
  SPAN_ID_REGEX,
  TRACE_ID_REGEX,
  tenantIdSchema,
  type SpanId,
  type TenantId,
  type TraceId,
} from './schemas/primitives';

/**
 * Header codec (settled decision: W3C-compatible wire format).
 *
 * Producers dual-write `traceparent` (canonical, interoperates with any
 * OTel-instrumented neighbor) plus the `x-*` set, which also carries what
 * traceparent cannot: service name, tenant, correlation id, parent span id.
 * Consumers prefer `traceparent` and fall back to `x-*`.
 */
const TRACEPARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface ParsedTraceparent {
  readonly traceId: TraceId;
  /** The sender's span id — it becomes the receiver's parentSpanId. */
  readonly parentId: SpanId;
  readonly sampled: boolean;
}

export function formatTraceparent(traceId: TraceId, spanId: SpanId, sampled = true): string {
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

/** Strict W3C level-1 parse. Returns null (never throws) on any malformed input. */
export function parseTraceparent(value: string): ParsedTraceparent | null {
  const match = TRACEPARENT_REGEX.exec(value.trim());
  if (!match) return null;
  const [, version, traceId, parentId, flags] = match;
  if (
    version === undefined ||
    traceId === undefined ||
    parentId === undefined ||
    flags === undefined
  ) {
    return null;
  }
  if (version !== '00') return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(parentId)) return null;
  return {
    traceId: traceId as TraceId,
    parentId: parentId as SpanId,
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
  };
}

/** What a consumer learns from inbound headers. `spanId` is the producer's span — the consumer's parent-to-be. */
export interface ExtractedTraceContext {
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly tenantId: TenantId | null;
  readonly serviceName: string | null;
  readonly correlationId: string | null;
}

function lowercaseHeaders(headers: Readonly<Record<string, string | undefined>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') map.set(key.toLowerCase(), value);
  }
  return map;
}

/**
 * Extract trace context from inbound headers (Kafka / AMQP / HTTP), case-
 * insensitively. Priority: `traceparent`, then `x-trace-id`/`x-span-id`.
 * Returns null when no valid context is present — the consumer then starts
 * a new root trace.
 */
export function extractTraceContext(
  headers: Readonly<Record<string, string | undefined>>
): ExtractedTraceContext | null {
  const map = lowercaseHeaders(headers);
  const get = (name: string): string | null => map.get(name) ?? null;

  let traceId: TraceId | null = null;
  let spanId: SpanId | null = null;

  const traceparent = get(HEADERS.TRACEPARENT);
  if (traceparent !== null) {
    const parsed = parseTraceparent(traceparent);
    if (parsed) {
      traceId = parsed.traceId;
      spanId = parsed.parentId;
    }
  }

  if (traceId === null || spanId === null) {
    const rawTraceId = get(HEADERS.TRACE_ID);
    const rawSpanId = get(HEADERS.SPAN_ID);
    if (
      rawTraceId !== null &&
      rawSpanId !== null &&
      TRACE_ID_REGEX.test(rawTraceId) &&
      SPAN_ID_REGEX.test(rawSpanId)
    ) {
      traceId = rawTraceId as TraceId;
      spanId = rawSpanId as SpanId;
    }
  }

  if (traceId === null || spanId === null) return null;

  const rawTenantId = get(HEADERS.TENANT_ID);
  const tenantId = rawTenantId !== null ? tenantIdSchema.safeParse(rawTenantId) : null;

  return {
    traceId,
    spanId,
    tenantId: tenantId?.success ? tenantId.data : null,
    serviceName: get(HEADERS.SERVICE_NAME),
    correlationId: get(HEADERS.CORRELATION_ID),
  };
}

/** Produce the outbound header set for a context (dual-write, see above). */
export function injectTraceHeaders(ctx: TraceContext): Record<string, string> {
  const headers: Record<string, string> = {
    [HEADERS.TRACEPARENT]: formatTraceparent(ctx.traceId, ctx.spanId),
    [HEADERS.TRACE_ID]: ctx.traceId,
    [HEADERS.SPAN_ID]: ctx.spanId,
    [HEADERS.SERVICE_NAME]: ctx.serviceName,
    [HEADERS.TENANT_ID]: ctx.tenantId,
  };
  if (ctx.parentSpanId !== null) headers[HEADERS.PARENT_SPAN_ID] = ctx.parentSpanId;
  if (ctx.correlationId !== null) headers[HEADERS.CORRELATION_ID] = ctx.correlationId;
  return headers;
}
