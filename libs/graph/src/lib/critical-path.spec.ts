import { buildTraceDag } from './build-trace-dag';
import { computeCriticalPath } from './critical-path';
import { sid, span, TRACE_A } from './test-fixtures';

describe('computeCriticalPath', () => {
  it('returns an empty path for an empty dag', () => {
    const path = computeCriticalPath(buildTraceDag(TRACE_A, []));
    expect(path.spanIds).toEqual([]);
    expect(path.durationMs).toBe(0);
  });

  it('follows a linear chain end to end', () => {
    const dag = buildTraceDag(TRACE_A, [span(1, null), span(2, 1), span(3, 2)]);
    const path = computeCriticalPath(dag);
    expect(path.spanIds).toEqual([sid(1), sid(2), sid(3)]);
    // span 3 starts at offset 200 and runs 50ms.
    expect(path.durationMs).toBe(250);
  });

  it('picks the slower branch of a fan-out', () => {
    const fast = span(2, 1, { durationMs: 10 });
    const slow = span(3, 1, { durationMs: 5_000 });
    const path = computeCriticalPath(buildTraceDag(TRACE_A, [span(1, null), fast, slow]));
    expect(path.spanIds).toEqual([sid(1), sid(3)]);
  });

  it('ends at an async child that outlives its parent', () => {
    const parent = span(1, null, { durationMs: 20 });
    const child = span(2, 1, { startTimeMs: 1_110, durationMs: 900 });
    const path = computeCriticalPath(buildTraceDag(TRACE_A, [parent, child]));
    expect(path.spanIds).toEqual([sid(1), sid(2)]);
    expect(path.durationMs).toBe(910);
  });

  it('lets an orphan subtree win when it finishes latest', () => {
    const rooted = span(1, null, { durationMs: 100 });
    const orphan = span(2, 99, { startTimeMs: 2_000, durationMs: 500 });
    const path = computeCriticalPath(buildTraceDag(TRACE_A, [rooted, orphan]));
    expect(path.spanIds).toEqual([sid(2)]);
  });

  it('returns a path even when forged parents form a loop', () => {
    const a = span(1, 2);
    const b = span(2, 1, { durationMs: 999 });
    const path = computeCriticalPath(buildTraceDag(TRACE_A, [a, b]));
    expect(path.spanIds.length).toBeGreaterThan(0);
    expect(path.spanIds.length).toBeLessThanOrEqual(2);
  });
});
