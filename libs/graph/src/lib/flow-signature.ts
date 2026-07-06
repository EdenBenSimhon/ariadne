import type { TraceId } from '@ariadne/protocol';
import type { TraceDag } from './types';

/**
 * Path variants via signature + clustering (spec §11): two traces belong to
 * the same *business flow* when their service/channel hop structure matches.
 * The signature is a deterministic DFS walk over cross-service hops — span
 * ids, timings and metadata are deliberately excluded, so the signature is
 * also safe to hand to an LLM (B4: distilled structure, never raw spans).
 */
export function computeFlowSignature(dag: TraceDag): string {
  const hops: string[] = [];
  const visited = new Set<string>();

  const visit = (spanId: string): void => {
    if (visited.has(spanId)) return;
    visited.add(spanId);
    const node = dag.nodes[spanId];
    if (node === undefined) return;
    for (const childId of node.children) {
      const child = dag.nodes[childId];
      if (child !== undefined && child.serviceName !== node.serviceName) {
        hops.push(`${node.serviceName} -[${child.channel}]-> ${child.serviceName}`);
      }
      visit(childId);
    }
  };
  for (const root of dag.roots) visit(root);

  if (hops.length > 0) return hops.join(' | ');
  // Single-service traces still form a flow.
  const first = dag.roots[0] !== undefined ? dag.nodes[dag.roots[0]] : undefined;
  return first !== undefined ? `${first.serviceName} (internal)` : '(empty)';
}

export interface FlowTraceInput {
  readonly traceId: TraceId;
  readonly durationMs: number;
  readonly hasError: boolean;
  readonly dag: TraceDag;
}

export interface BusinessFlow {
  /** The clustered hop structure — human- and LLM-readable. */
  readonly signature: string;
  readonly services: readonly string[];
  readonly traceCount: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly avgDurationMs: number;
  readonly exampleTraceId: TraceId;
}

/** Cluster traces by flow signature; most frequent flows first. */
export function discoverBusinessFlows(traces: readonly FlowTraceInput[]): BusinessFlow[] {
  const groups = new Map<
    string,
    { services: Set<string>; count: number; errors: number; totalMs: number; example: TraceId }
  >();

  for (const trace of traces) {
    const signature = computeFlowSignature(trace.dag);
    const group = groups.get(signature) ?? {
      services: new Set<string>(),
      count: 0,
      errors: 0,
      totalMs: 0,
      example: trace.traceId,
    };
    for (const node of Object.values(trace.dag.nodes)) group.services.add(node.serviceName);
    group.count += 1;
    if (trace.hasError) group.errors += 1;
    group.totalMs += trace.durationMs;
    groups.set(signature, group);
  }

  return [...groups.entries()]
    .map(([signature, group]) => ({
      signature,
      services: [...group.services].sort(),
      traceCount: group.count,
      errorCount: group.errors,
      errorRate: group.count > 0 ? group.errors / group.count : 0,
      avgDurationMs: group.count > 0 ? Math.round(group.totalMs / group.count) : 0,
      exampleTraceId: group.example,
    }))
    .sort((a, b) => b.traceCount - a.traceCount || a.signature.localeCompare(b.signature));
}
