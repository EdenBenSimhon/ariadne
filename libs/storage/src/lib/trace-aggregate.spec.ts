import type { SpanId, TenantId, TraceId } from '@ariadne/protocol';
import { computeTraceAggregates, type AggregateSpan } from './trace-aggregate';

const tenant = 'acme' as TenantId;
const traceA = 'a'.repeat(32) as TraceId;
const traceB = 'b'.repeat(32) as TraceId;

let spanCounter = 0;
function span(overrides: Partial<AggregateSpan>): AggregateSpan {
  spanCounter += 1;
  return {
    tenantId: tenant,
    traceId: traceA,
    parentSpanId: spanCounter.toString(16).padStart(16, '0') as SpanId,
    serviceName: 'inventory-service',
    startTime: new Date('2026-07-06T10:00:01.000Z'),
    durationMs: 50,
    status: 'OK',
    ...overrides,
  };
}

describe('computeTraceAggregates', () => {
  it('returns an empty list for no spans', () => {
    expect(computeTraceAggregates([])).toEqual([]);
  });

  it('groups by (tenant, trace) and counts spans', () => {
    const result = computeTraceAggregates([
      span({}),
      span({}),
      span({ traceId: traceB }),
      span({ tenantId: 'other' as TenantId }),
    ]);
    expect(result.map((a) => [a.tenantId, a.traceId, a.spanCount])).toEqual([
      ['acme', traceA, 2],
      ['acme', traceB, 1],
      ['other', traceA, 1],
    ]);
  });

  it('detects the root service even when the root arrives last in the batch', () => {
    const result = computeTraceAggregates([
      span({ serviceName: 'payment-service' }),
      span({ parentSpanId: null, serviceName: 'order-service' }),
    ]);
    expect(result[0]?.rootService).toBe('order-service');
  });

  it('leaves rootService null when no root span is in the batch (out-of-order arrival)', () => {
    const result = computeTraceAggregates([span({}), span({})]);
    expect(result[0]?.rootService).toBeNull();
  });

  it('computes min start, max end and ORs the error flag', () => {
    const result = computeTraceAggregates([
      span({ startTime: new Date('2026-07-06T10:00:02.000Z'), durationMs: 10 }),
      span({ startTime: new Date('2026-07-06T10:00:00.000Z'), durationMs: 100, status: 'ERROR' }),
      span({ startTime: new Date('2026-07-06T10:00:01.000Z'), durationMs: 5000 }),
    ]);
    const trace = result[0];
    expect(trace?.startTime).toEqual(new Date('2026-07-06T10:00:00.000Z'));
    expect(trace?.endTime).toEqual(new Date('2026-07-06T10:00:06.000Z'));
    expect(trace?.hasError).toBe(true);
  });

  it('is insensitive to input order (commutative merge)', () => {
    const spans = [
      span({ parentSpanId: null, serviceName: 'order-service', status: 'ERROR' }),
      span({ startTime: new Date('2026-07-06T09:59:00.000Z') }),
      span({ durationMs: 9000 }),
    ];
    const forward = computeTraceAggregates(spans);
    const reversed = computeTraceAggregates([...spans].reverse());
    expect(forward).toEqual(reversed);
  });
});
