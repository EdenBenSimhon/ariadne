import { TRACE_HEADERS } from './constants';
import { TraceContext, TraceContextSchema } from './schemas';

const TRACEPARENT_VERSION = '00';
const TRACEPARENT_FLAGS_SAMPLED = '01';

const uuidToHex = (uuid: string): string => uuid.replace(/-/g, '').toLowerCase();

/**
 * Build a W3C `traceparent` value: `version-traceid-parentid-flags`.
 *
 * W3C trace-id is 16 bytes (32 hex) — a UUID fits exactly. W3C parent-id is only
 * 8 bytes (16 hex), so a 16-byte UUID span id cannot fit losslessly; we use the
 * first 16 hex chars for ecosystem interop. Full-fidelity span ids travel in the
 * `x-span-id` / `x-parent-span-id` headers, which are authoritative on extract.
 */
const buildTraceParent = (traceId: string, spanId: string): string => {
  const traceHex = uuidToHex(traceId);
  const spanHex = uuidToHex(spanId).slice(0, 16);
  return `${TRACEPARENT_VERSION}-${traceHex}-${spanHex}-${TRACEPARENT_FLAGS_SAMPLED}`;
};

/**
 * Serialize a trace context into transport-neutral headers (spec §3).
 * Emits a W3C `traceparent` for interop plus full-fidelity `x-*` headers.
 */
export function injectTraceContext(ctx: TraceContext): Record<string, string> {
  const headers: Record<string, string> = {
    [TRACE_HEADERS.traceParent]: buildTraceParent(ctx.traceId, ctx.spanId),
    [TRACE_HEADERS.traceId]: ctx.traceId,
    [TRACE_HEADERS.spanId]: ctx.spanId,
    [TRACE_HEADERS.serviceName]: ctx.serviceName,
    [TRACE_HEADERS.tenantId]: ctx.tenantId,
  };
  if (ctx.parentSpanId !== null) {
    headers[TRACE_HEADERS.parentSpanId] = ctx.parentSpanId;
  }
  if (ctx.correlationId !== undefined) {
    headers[TRACE_HEADERS.correlationId] = ctx.correlationId;
  }
  return headers;
}

const readHeader = (
  headers: Record<string, string | undefined>,
  name: string
): string | undefined => {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
};

/**
 * Reconstruct a trace context from headers (spec §3). The `x-*` headers are
 * authoritative for full UUID fidelity; returns null if the required fields are
 * absent or the result fails validation.
 */
export function extractTraceContext(
  headers: Record<string, string | undefined>
): TraceContext | null {
  const traceId = readHeader(headers, TRACE_HEADERS.traceId);
  const spanId = readHeader(headers, TRACE_HEADERS.spanId);
  const serviceName = readHeader(headers, TRACE_HEADERS.serviceName);
  const tenantId = readHeader(headers, TRACE_HEADERS.tenantId);
  const parentSpanId = readHeader(headers, TRACE_HEADERS.parentSpanId);
  const correlationId = readHeader(headers, TRACE_HEADERS.correlationId);

  if (!traceId || !spanId || !serviceName || !tenantId) return null;

  const candidate = {
    traceId,
    spanId,
    parentSpanId: parentSpanId ?? null,
    serviceName,
    tenantId,
    ...(correlationId !== undefined ? { correlationId } : {}),
  };

  const result = TraceContextSchema.safeParse(candidate);
  return result.success ? result.data : null;
}
