import { buildTraceDag, type GraphSpan } from '@ariadne/graph';
import type { SpanId, TraceId } from '@ariadne/protocol';
import { computeTimelineRows } from './timeline-layout';

const traceId = 'f'.repeat(32) as TraceId;
const sid = (n: number): SpanId => n.toString(16).padStart(16, '0') as SpanId;

function span(id: number, parent: number | null, overrides: Partial<GraphSpan> = {}): GraphSpan {
  return {
    spanId: sid(id),
    parentSpanId: parent === null ? null : sid(parent),
    serviceName: `svc-${id}`,
    spanKind: 'CONSUMER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: `op-${id}`,
    startTimeMs: 1_000 + id * 100,
    durationMs: 100,
    status: 'OK',
    error: null,
    ...overrides,
  };
}

describe('computeTimelineRows', () => {
  it('flattens the forest in DFS order with API-computed depths', () => {
    const dag = buildTraceDag(traceId, [span(1, null), span(2, 1), span(3, 2)]);
    const rows = computeTimelineRows(dag);
    expect(rows.map((r) => r.node.spanId)).toEqual([sid(1), sid(2), sid(3)]);
    expect(rows.map((r) => r.node.depth)).toEqual([0, 1, 2]);
  });

  it('positions bars as percentages of the trace window', () => {
    // Window: 1100 → 1300 (200ms); span 2 starts at 1200 and runs 100ms.
    const dag = buildTraceDag(traceId, [span(1, null), span(2, 1)]);
    const rows = computeTimelineRows(dag);
    expect(rows[0]?.leftPct).toBe(0);
    expect(rows[1]?.leftPct).toBeCloseTo(50, 5);
    expect(rows[1]?.widthPct).toBeCloseTo(50, 5);
  });

  it('clamps zero-duration spans to a visible minimum width', () => {
    const dag = buildTraceDag(traceId, [span(1, null), span(2, 1, { durationMs: 0 })]);
    const rows = computeTimelineRows(dag);
    expect(rows[1]?.widthPct).toBeGreaterThanOrEqual(0.4);
  });

  it('renders orphan subtrees after rooted ones', () => {
    const dag = buildTraceDag(traceId, [span(1, null), span(5, 99)]);
    const rows = computeTimelineRows(dag);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.node.orphaned).toBe(true);
  });

  it('does not divide by zero on a single instant span', () => {
    const dag = buildTraceDag(traceId, [span(1, null, { durationMs: 0 })]);
    const rows = computeTimelineRows(dag);
    expect(Number.isFinite(rows[0]?.leftPct)).toBe(true);
    expect(Number.isFinite(rows[0]?.widthPct)).toBe(true);
  });
});
