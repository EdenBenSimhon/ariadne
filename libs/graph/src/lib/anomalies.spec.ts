import type { TraceId } from '@ariadne/protocol';
import { detectAnomalies } from './anomalies';
import type { BusinessFlow } from './flow-signature';
import type { TopologyEdge, TopologyGraph } from './types';

function edge(overrides: Partial<TopologyEdge>): TopologyEdge {
  return {
    source: 'a',
    target: 'b',
    channel: 'events',
    transport: 'kafka',
    count: 100,
    avgDurationMs: 50,
    errorCount: 0,
    ...overrides,
  };
}

function topology(overrides: Partial<TopologyGraph>): TopologyGraph {
  return { nodes: [], edges: [], cycles: [], truncated: false, ...overrides };
}

function flow(overrides: Partial<BusinessFlow>): BusinessFlow {
  return {
    signature: 'a -[events]-> b',
    services: ['a', 'b'],
    traceCount: 10,
    errorCount: 0,
    errorRate: 0,
    avgDurationMs: 100,
    exampleTraceId: 'f'.repeat(32) as TraceId,
    ...overrides,
  };
}

describe('detectAnomalies', () => {
  it('returns nothing for a healthy system', () => {
    expect(detectAnomalies(topology({ edges: [edge({}), edge({ target: 'c' })] }), [flow({})])).toEqual([]);
  });

  it('surfaces service cycles as informational', () => {
    const result = detectAnomalies(topology({ cycles: [['order', 'payment']] }), []);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'service-cycle', severity: 'info' });
    expect(result[0]?.subject).toBe('order → payment');
  });

  it('grades error hotspots by rate', () => {
    const result = detectAnomalies(
      topology({
        edges: [
          edge({ errorCount: 15 }), // 15% → warning
          edge({ target: 'c', errorCount: 60 }), // 60% → critical
          edge({ target: 'd', errorCount: 1 }), // 1% → fine
        ],
      }),
      []
    );
    expect(result.map((a) => a.severity)).toEqual(['critical', 'warning']);
    expect(result[0]?.detail).toContain('60%');
  });

  it('flags a hop that dominates latency', () => {
    const result = detectAnomalies(
      topology({
        edges: [edge({}), edge({ target: 'c', avgDurationMs: 5_000 })],
      }),
      []
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('latency-dominant');
    expect(result[0]?.subject).toContain('-> c');
  });

  it('flags failing business flows but ignores single-trace noise', () => {
    const result = detectAnomalies(topology({}), [
      flow({ signature: 'noisy', traceCount: 1, errorCount: 1, errorRate: 1 }),
      flow({ signature: 'broken checkout', traceCount: 8, errorCount: 4, errorRate: 0.5 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'failing-flow', severity: 'critical', subject: 'broken checkout' });
  });

  it('orders results by severity', () => {
    const result = detectAnomalies(
      topology({
        cycles: [['a', 'b']],
        edges: [edge({ errorCount: 90 }), edge({ target: 'c', errorCount: 12 })],
      }),
      []
    );
    expect(result.map((a) => a.severity)).toEqual(['critical', 'warning', 'info']);
  });
});
