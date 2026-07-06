import { buildTraceDag, type GraphSpan } from '@ariadne/graph';
import type { SpanId, TraceId } from '@ariadne/protocol';
import { DEFAULT_DAG_LAYOUT, layoutDag } from './dag-layout';

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
    durationMs: 50,
    status: 'OK',
    error: null,
    ...overrides,
  };
}

describe('layoutDag', () => {
  it('columns follow depth; a diamond joins in the deeper column', () => {
    // 1 → 2, 1 → 3, and 4 hangs off 3 (deepest chain).
    const layout = layoutDag(buildTraceDag(traceId, [span(1, null), span(2, 1), span(3, 1), span(4, 3)]));
    const byId = new Map(layout.nodes.map((n) => [n.node.spanId, n]));
    expect(byId.get(sid(1))?.x).toBe(0);
    expect(byId.get(sid(2))?.x).toBe(DEFAULT_DAG_LAYOUT.colW);
    expect(byId.get(sid(3))?.x).toBe(DEFAULT_DAG_LAYOUT.colW);
    expect(byId.get(sid(4))?.x).toBe(2 * DEFAULT_DAG_LAYOUT.colW);
    // Siblings stack within the column.
    expect(byId.get(sid(2))?.y).not.toBe(byId.get(sid(3))?.y);
  });

  it('produces one edge per resolvable parent link, flagged on child errors', () => {
    const layout = layoutDag(
      buildTraceDag(traceId, [
        span(1, null),
        span(2, 1, { status: 'ERROR', error: 'boom' }),
        span(3, 99), // orphan → no edge
      ])
    );
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.error).toBe(true);
    expect(layout.edges[0]?.path).toMatch(/^M [\d. ]+C/);
  });

  it('is deterministic and sized to cover all nodes', () => {
    const spans = [span(1, null), span(2, 1), span(3, 1)];
    const a = layoutDag(buildTraceDag(traceId, spans));
    const b = layoutDag(buildTraceDag(traceId, spans));
    expect(a).toEqual(b);
    expect(a.width).toBe(2 * DEFAULT_DAG_LAYOUT.colW);
    expect(a.height).toBe(2 * DEFAULT_DAG_LAYOUT.rowH);
  });
});
