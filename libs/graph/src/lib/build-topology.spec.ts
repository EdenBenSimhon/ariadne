import { buildTopology } from './build-topology';
import { TRACE_B, tspan } from './test-fixtures';

describe('buildTopology', () => {
  it('returns an empty graph for no spans', () => {
    const topology = buildTopology([]);
    expect(topology.nodes).toEqual([]);
    expect(topology.edges).toEqual([]);
    expect(topology.truncated).toBe(false);
  });

  it('merges the same hop across traces into one weighted edge', () => {
    const spans = [
      tspan(1, null, { serviceName: 'order' }),
      tspan(2, 1, { serviceName: 'inventory', durationMs: 100 }),
      tspan(3, null, { serviceName: 'order', traceId: TRACE_B }),
      tspan(4, 3, { serviceName: 'inventory', durationMs: 300, traceId: TRACE_B }),
    ];
    const topology = buildTopology(spans);
    expect(topology.edges).toHaveLength(1);
    const edge = topology.edges[0];
    expect(edge?.source).toBe('order');
    expect(edge?.target).toBe('inventory');
    expect(edge?.count).toBe(2);
    expect(edge?.avgDurationMs).toBe(200);
  });

  it('counts errors on both the node and the receiving edge', () => {
    const topology = buildTopology([
      tspan(1, null, { serviceName: 'order' }),
      tspan(2, 1, { serviceName: 'payment', status: 'ERROR', error: 'boom' }),
    ]);
    expect(topology.nodes.find((n) => n.service === 'payment')?.errorCount).toBe(1);
    expect(topology.edges[0]?.errorCount).toBe(1);
  });

  it('never emits self-edges for same-service parent-child hops', () => {
    const topology = buildTopology([
      tspan(1, null, { serviceName: 'order' }),
      tspan(2, 1, { serviceName: 'order' }),
    ]);
    expect(topology.edges).toEqual([]);
    expect(topology.nodes[0]?.spanCount).toBe(2);
  });

  it('counts orphan spans as node stats without edges', () => {
    const topology = buildTopology([tspan(2, 99, { serviceName: 'inventory' })]);
    expect(topology.nodes).toHaveLength(1);
    expect(topology.edges).toEqual([]);
  });

  it('surfaces service-level cycles (A→B→A choreography)', () => {
    const topology = buildTopology([
      tspan(1, null, { serviceName: 'order' }),
      tspan(2, 1, { serviceName: 'payment' }),
      tspan(3, 2, { serviceName: 'order', channel: 'payment.completed' }),
    ]);
    expect(topology.cycles).toHaveLength(1);
    expect([...topology.cycles[0]!].sort()).toEqual(['order', 'payment']);
  });

  it('passes the truncated flag through', () => {
    expect(buildTopology([], { truncated: true }).truncated).toBe(true);
  });
});
