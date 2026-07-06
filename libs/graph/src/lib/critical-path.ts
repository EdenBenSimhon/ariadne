import type { SpanId } from '@ariadne/protocol';
import type { CriticalPath, TraceDag, TraceDagNode } from './types';

/**
 * Critical path (spec §11): the chain that determines the trace's end-to-end
 * latency. Because every span has exactly one parent, the latest finish over
 * the whole forest pins the path — walk from that node up to its root.
 * A visited guard keeps forged parent loops from hanging the walk.
 */
export function computeCriticalPath(dag: TraceDag): CriticalPath {
  let latest: TraceDagNode | null = null;
  for (const node of Object.values(dag.nodes)) {
    const finish = node.startOffsetMs + node.durationMs;
    if (latest === null || finish > latest.startOffsetMs + latest.durationMs) {
      latest = node;
    }
  }
  if (latest === null) return { spanIds: [], durationMs: 0 };

  const path: SpanId[] = [];
  const visited = new Set<SpanId>();
  let current: TraceDagNode | undefined = latest;
  while (current !== undefined && !visited.has(current.spanId)) {
    visited.add(current.spanId);
    path.push(current.spanId);
    current =
      current.parentSpanId !== null ? dag.nodes[current.parentSpanId] : undefined;
  }
  path.reverse();

  return { spanIds: path, durationMs: latest.startOffsetMs + latest.durationMs };
}
