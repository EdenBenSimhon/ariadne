import { buildTraceDag } from './build-trace-dag';
import { sid, span, TRACE_A } from './test-fixtures';

describe('buildTraceDag', () => {
  it('returns an empty forest for no spans', () => {
    const dag = buildTraceDag(TRACE_A, []);
    expect(dag.roots).toEqual([]);
    expect(dag.nodes).toEqual({});
    expect(dag.durationMs).toBe(0);
  });

  it('builds a linear chain with depths and offsets', () => {
    const dag = buildTraceDag(TRACE_A, [span(1, null), span(2, 1), span(3, 2)]);
    expect(dag.roots).toEqual([sid(1)]);
    expect(dag.nodes[sid(1)]?.depth).toBe(0);
    expect(dag.nodes[sid(2)]?.depth).toBe(1);
    expect(dag.nodes[sid(3)]?.depth).toBe(2);
    expect(dag.nodes[sid(1)]?.startOffsetMs).toBe(0);
    expect(dag.nodes[sid(3)]?.startOffsetMs).toBe(200);
    expect(dag.cycles).toEqual([]);
    expect(dag.orphanCount).toBe(0);
  });

  it('sorts children by start offset in a fan-out', () => {
    const late = span(2, 1, { startTimeMs: 5_000 });
    const early = span(3, 1, { startTimeMs: 1_100 });
    const dag = buildTraceDag(TRACE_A, [span(1, null), late, early]);
    expect(dag.nodes[sid(1)]?.children).toEqual([sid(3), sid(2)]);
  });

  it('flags spans whose parent never arrived as orphan roots', () => {
    const dag = buildTraceDag(TRACE_A, [span(1, null), span(2, 99), span(3, 2)]);
    expect(dag.roots).toEqual([sid(1), sid(2)]);
    expect(dag.nodes[sid(2)]?.orphaned).toBe(true);
    expect(dag.nodes[sid(2)]?.depth).toBe(0);
    expect(dag.nodes[sid(3)]?.depth).toBe(1);
    expect(dag.nodes[sid(3)]?.orphaned).toBe(false);
    expect(dag.orphanCount).toBe(1);
  });

  it('dedupes duplicate span ids, first wins', () => {
    const first = span(2, 1, { serviceName: 'first' });
    const dupe = span(2, 1, { serviceName: 'second' });
    const dag = buildTraceDag(TRACE_A, [span(1, null), first, dupe]);
    expect(Object.keys(dag.nodes)).toHaveLength(2);
    expect(dag.nodes[sid(2)]?.serviceName).toBe('first');
  });

  it('reports forged parent loops and still terminates', () => {
    const a = span(1, 2);
    const b = span(2, 1);
    const dag = buildTraceDag(TRACE_A, [a, b, span(3, null)]);
    expect(dag.cycles.length).toBeGreaterThan(0);
    // Cycle island nodes are surfaced as orphaned roots so the UI can render them.
    expect(dag.roots).toContain(sid(3));
    expect(Object.keys(dag.nodes)).toHaveLength(3);
  });

  it('trace duration spans min start to max end, not the root duration', () => {
    const root = span(1, null, { startTimeMs: 1_000, durationMs: 10 });
    const child = span(2, 1, { startTimeMs: 1_500, durationMs: 400 });
    const dag = buildTraceDag(TRACE_A, [root, child]);
    expect(dag.startTimeMs).toBe(1_000);
    expect(dag.durationMs).toBe(900);
  });
});
