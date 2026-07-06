import type { SpanId, TraceId } from '@ariadne/protocol';
import type { GraphSpan, TopologySpan } from './types';

export const TRACE_A = 'a'.repeat(32) as TraceId;
export const TRACE_B = 'b'.repeat(32) as TraceId;

export function sid(n: number): SpanId {
  return n.toString(16).padStart(16, '0') as SpanId;
}

export function span(
  id: number,
  parent: number | null,
  overrides: Partial<GraphSpan> = {}
): GraphSpan {
  return {
    spanId: sid(id),
    parentSpanId: parent === null ? null : sid(parent),
    serviceName: `svc-${id}`,
    spanKind: 'CONSUMER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: `op-${id}`,
    startTimeMs: 1_000 + id * 100,
    durationMs: 50,
    status: 'OK',
    error: null,
    ...overrides,
  };
}

export function tspan(
  id: number,
  parent: number | null,
  overrides: Partial<TopologySpan> = {}
): TopologySpan {
  return { ...span(id, parent, overrides), traceId: overrides.traceId ?? TRACE_A };
}
