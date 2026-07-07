import type { SpanId, TraceId } from '@ariadne/protocol';
import { detectCycles } from './detect-cycles';
import type { GraphSpan, TraceDag, TraceDagNode } from './types';

/**
 * Trace reconstruction (spec §11): parentSpanId chain → forest, O(n).
 * Handles the messy real world: duplicate span ids (first wins), orphans
 * (parent never arrived → subtree root, flagged), forged parent loops
 * (detected, reported, and traversal still terminates).
 */
export function buildTraceDag(traceId: TraceId, spans: readonly GraphSpan[]): TraceDag {
  const byId = new Map<SpanId, GraphSpan>();
  for (const span of spans) {
    if (!byId.has(span.spanId)) byId.set(span.spanId, span);
  }

  if (byId.size === 0) {
    return {
      traceId,
      nodes: {},
      roots: [],
      orphanCount: 0,
      startTimeMs: 0,
      durationMs: 0,
      cycles: [],
    };
  }

  let startTimeMs = Number.POSITIVE_INFINITY;
  let endTimeMs = Number.NEGATIVE_INFINITY;
  for (const span of byId.values()) {
    startTimeMs = Math.min(startTimeMs, span.startTimeMs);
    endTimeMs = Math.max(endTimeMs, span.startTimeMs + span.durationMs);
  }

  const children = new Map<SpanId, SpanId[]>();
  const trueRoots: SpanId[] = [];
  const orphanRoots: SpanId[] = [];
  for (const span of byId.values()) {
    if (span.parentSpanId === null) {
      trueRoots.push(span.spanId);
    } else if (!byId.has(span.parentSpanId)) {
      orphanRoots.push(span.spanId);
    } else {
      const siblings = children.get(span.parentSpanId) ?? [];
      siblings.push(span.spanId);
      children.set(span.parentSpanId, siblings);
    }
  }

  const adjacency = new Map<SpanId, readonly SpanId[]>();
  for (const id of byId.keys()) adjacency.set(id, children.get(id) ?? []);
  const cycles = detectCycles(adjacency);

  const byOffset = (a: SpanId, b: SpanId): number =>
    (byId.get(a)?.startTimeMs ?? 0) - (byId.get(b)?.startTimeMs ?? 0);
  trueRoots.sort(byOffset);
  orphanRoots.sort(byOffset);
  for (const siblings of children.values()) siblings.sort(byOffset);

  // BFS from the roots assigns depth; the visited set makes forged parent
  // loops harmless. Cycle-only islands (no root at all) are picked up last.
  const depth = new Map<SpanId, number>();
  const visit = (roots: readonly SpanId[]): void => {
    const queue: SpanId[] = [...roots];
    for (const root of roots) if (!depth.has(root)) depth.set(root, 0);
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      const parentDepth = depth.get(id) ?? 0;
      for (const child of children.get(id) ?? []) {
        if (depth.has(child)) continue;
        depth.set(child, parentDepth + 1);
        queue.push(child);
      }
    }
  };
  visit(trueRoots);
  visit(orphanRoots);
  const cycleIslandRoots: SpanId[] = [...byId.keys()].filter((id) => !depth.has(id));
  cycleIslandRoots.sort(byOffset);
  visit(cycleIslandRoots);

  const orphanSet = new Set<SpanId>([...orphanRoots, ...cycleIslandRoots]);
  const nodes: Record<string, TraceDagNode> = {};
  for (const span of byId.values()) {
    nodes[span.spanId] = {
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      children: children.get(span.spanId) ?? [],
      serviceName: span.serviceName,
      spanKind: span.spanKind,
      transport: span.transport,
      channel: span.channel,
      operationName: span.operationName,
      startOffsetMs: span.startTimeMs - startTimeMs,
      durationMs: span.durationMs,
      status: span.status,
      error: span.error,
      depth: depth.get(span.spanId) ?? 0,
      orphaned: orphanSet.has(span.spanId),
      metadata: span.metadata ?? null,
    };
  }

  return {
    traceId,
    nodes,
    roots: [...trueRoots, ...orphanRoots, ...cycleIslandRoots],
    orphanCount: orphanSet.size,
    startTimeMs,
    durationMs: Math.max(0, endTimeMs - startTimeMs),
    cycles,
  };
}
