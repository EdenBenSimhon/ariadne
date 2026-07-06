import { HEADERS } from './constants';
import { newSpanId, newTraceId } from './ids';
import type { TraceContext } from './schemas/envelope';
import { tenantIdSchema } from './schemas/primitives';
import {
  extractTraceContext,
  formatTraceparent,
  injectTraceHeaders,
  parseTraceparent,
} from './traceparent';

const traceId = newTraceId();
const spanId = newSpanId();
const parentSpanId = newSpanId();
const tenantId = tenantIdSchema.parse('acme');

describe('traceparent codec', () => {
  it('round-trips format → parse', () => {
    const parsed = parseTraceparent(formatTraceparent(traceId, spanId));
    expect(parsed).toEqual({ traceId, parentId: spanId, sampled: true });
  });

  it('encodes the sampled flag', () => {
    expect(formatTraceparent(traceId, spanId, false)).toBe(`00-${traceId}-${spanId}-00`);
    expect(parseTraceparent(`00-${traceId}-${spanId}-00`)?.sampled).toBe(false);
  });

  it.each([
    ['wrong version', `01-${traceId}-${spanId}-01`],
    ['ff version', `ff-${traceId}-${spanId}-01`],
    ['all-zero trace id', `00-${'0'.repeat(32)}-${spanId}-01`],
    ['all-zero parent id', `00-${traceId}-${'0'.repeat(16)}-01`],
    ['short trace id', `00-${'a'.repeat(31)}-${spanId}-01`],
    ['uppercase hex', `00-${'A'.repeat(32)}-${spanId}-01`],
    ['trailing junk', `00-${traceId}-${spanId}-01-extra`],
    ['garbage', 'not-a-traceparent'],
    ['empty', ''],
  ])('rejects %s', (_name, value) => {
    expect(parseTraceparent(value)).toBeNull();
  });
});

describe('injectTraceHeaders', () => {
  const ctx: TraceContext = {
    traceId,
    spanId,
    parentSpanId,
    tenantId,
    serviceName: 'order-service',
    correlationId: 'corr-1',
  };

  it('dual-writes traceparent and the x-* set', () => {
    const headers = injectTraceHeaders(ctx);
    expect(headers[HEADERS.TRACEPARENT]).toBe(`00-${traceId}-${spanId}-01`);
    expect(headers[HEADERS.TRACE_ID]).toBe(traceId);
    expect(headers[HEADERS.SPAN_ID]).toBe(spanId);
    expect(headers[HEADERS.PARENT_SPAN_ID]).toBe(parentSpanId);
    expect(headers[HEADERS.SERVICE_NAME]).toBe('order-service');
    expect(headers[HEADERS.TENANT_ID]).toBe('acme');
    expect(headers[HEADERS.CORRELATION_ID]).toBe('corr-1');
  });

  it('omits parent and correlation headers for a root context', () => {
    const headers = injectTraceHeaders({ ...ctx, parentSpanId: null, correlationId: null });
    expect(headers[HEADERS.PARENT_SPAN_ID]).toBeUndefined();
    expect(headers[HEADERS.CORRELATION_ID]).toBeUndefined();
  });
});

describe('extractTraceContext', () => {
  it('prefers traceparent over conflicting x-* headers', () => {
    const otherTraceId = newTraceId();
    const otherSpanId = newSpanId();
    const extracted = extractTraceContext({
      [HEADERS.TRACEPARENT]: formatTraceparent(traceId, spanId),
      [HEADERS.TRACE_ID]: otherTraceId,
      [HEADERS.SPAN_ID]: otherSpanId,
    });
    expect(extracted?.traceId).toBe(traceId);
    expect(extracted?.spanId).toBe(spanId);
  });

  it('falls back to x-* when traceparent is absent or malformed', () => {
    const extracted = extractTraceContext({
      [HEADERS.TRACEPARENT]: 'garbage',
      [HEADERS.TRACE_ID]: traceId,
      [HEADERS.SPAN_ID]: spanId,
      [HEADERS.TENANT_ID]: 'acme',
      [HEADERS.SERVICE_NAME]: 'order-service',
      [HEADERS.CORRELATION_ID]: 'corr-1',
    });
    expect(extracted).toEqual({
      traceId,
      spanId,
      tenantId: 'acme',
      serviceName: 'order-service',
      correlationId: 'corr-1',
    });
  });

  it('is case-insensitive on header names (HTTP normalization)', () => {
    const extracted = extractTraceContext({
      'X-Trace-Id': traceId,
      'X-Span-Id': spanId,
    });
    expect(extracted?.traceId).toBe(traceId);
  });

  it('returns null when no valid context is present', () => {
    expect(extractTraceContext({})).toBeNull();
    expect(extractTraceContext({ [HEADERS.TRACE_ID]: 'nope' })).toBeNull();
    expect(extractTraceContext({ [HEADERS.TRACE_ID]: traceId })).toBeNull();
  });

  it('drops an invalid tenant id instead of failing extraction', () => {
    const extracted = extractTraceContext({
      [HEADERS.TRACE_ID]: traceId,
      [HEADERS.SPAN_ID]: spanId,
      [HEADERS.TENANT_ID]: 'NOT VALID!',
    });
    expect(extracted?.tenantId).toBeNull();
  });
});
