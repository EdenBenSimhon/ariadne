/**
 * Cycle detection via iterative DFS 3-coloring (spec §11 "loop detection").
 * Generic over node id so it serves both span graphs (SpanId) and the
 * service-level topology (service names).
 *
 * Input is attacker-influenceable (parent ids come from message headers), so
 * this must terminate on any shape — self-loops, long rings, dense meshes —
 * and never recurse (no stack overflow on deep chains).
 */
export function detectCycles<T extends string>(
  adjacency: ReadonlyMap<T, readonly T[]>
): T[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<T, number>();
  const cycles: T[][] = [];

  for (const start of adjacency.keys()) {
    if ((color.get(start) ?? WHITE) !== WHITE) continue;
    const stack: Array<{ node: T; index: number }> = [{ node: start, index: 0 }];
    const path: T[] = [start];
    color.set(start, GRAY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const neighbors = adjacency.get(frame.node) ?? [];
      const next = neighbors[frame.index];
      if (next !== undefined) {
        frame.index += 1;
        const nextColor = color.get(next) ?? WHITE;
        if (nextColor === GRAY) {
          const from = path.indexOf(next);
          if (from >= 0) cycles.push(path.slice(from));
        } else if (nextColor === WHITE) {
          color.set(next, GRAY);
          stack.push({ node: next, index: 0 });
          path.push(next);
        }
      } else {
        color.set(frame.node, BLACK);
        stack.pop();
        path.pop();
      }
    }
  }
  return cycles;
}
