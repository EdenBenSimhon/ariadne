import { detectCycles } from './detect-cycles';

const adj = (entries: Record<string, string[]>): Map<string, readonly string[]> =>
  new Map(Object.entries(entries));

describe('detectCycles', () => {
  it('returns [] for an acyclic graph', () => {
    expect(detectCycles(adj({ a: ['b', 'c'], b: ['d'], c: [], d: [] }))).toEqual([]);
  });

  it('detects a self-loop', () => {
    expect(detectCycles(adj({ a: ['a'] }))).toEqual([['a']]);
  });

  it('detects a two-node loop', () => {
    const cycles = detectCycles(adj({ a: ['b'], b: ['a'] }));
    expect(cycles).toHaveLength(1);
    expect([...cycles[0]!].sort()).toEqual(['a', 'b']);
  });

  it('reports the cycle while healthy branches stay unaffected', () => {
    const cycles = detectCycles(adj({ root: ['a', 'x'], a: ['b'], b: ['a'], x: [] }));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('terminates on a large ring without recursion overflow', () => {
    const size = 5_000;
    const ring: Record<string, string[]> = {};
    for (let i = 0; i < size; i += 1) ring[`n${i}`] = [`n${(i + 1) % size}`];
    const cycles = detectCycles(adj(ring));
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(size);
  });
});
