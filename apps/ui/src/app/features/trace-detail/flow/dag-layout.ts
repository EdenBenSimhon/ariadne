import type { TraceDag, TraceDagNode } from '@ariadne/graph';

/**
 * Pure layered DAG layout: column = the API-computed depth, row = DFS
 * discovery order within that depth. A single trace is tens of spans, so a
 * hand-rolled layout beats pulling in a layout library.
 */
export interface PositionedNode {
  readonly node: TraceDagNode;
  readonly x: number;
  readonly y: number;
}

export interface PositionedEdge {
  /** SVG path `d` — cubic bezier from parent right-center to child left-center. */
  readonly path: string;
  readonly error: boolean;
}

export interface PositionedDag {
  readonly nodes: readonly PositionedNode[];
  readonly edges: readonly PositionedEdge[];
  readonly width: number;
  readonly height: number;
}

export interface DagLayoutOptions {
  readonly colW: number;
  readonly rowH: number;
  readonly nodeW: number;
  readonly nodeH: number;
}

export const DEFAULT_DAG_LAYOUT: DagLayoutOptions = {
  colW: 230,
  rowH: 76,
  nodeW: 190,
  nodeH: 56,
};

export function layoutDag(
  dag: TraceDag,
  opts: DagLayoutOptions = DEFAULT_DAG_LAYOUT,
): PositionedDag {
  const order: TraceDagNode[] = [];
  const visited = new Set<string>();
  const visit = (spanId: string): void => {
    if (visited.has(spanId)) return;
    visited.add(spanId);
    const node = dag.nodes[spanId];
    if (node === undefined) return;
    order.push(node);
    for (const child of node.children) visit(child);
  };
  for (const root of dag.roots) visit(root);

  const rowsPerDepth = new Map<number, number>();
  const positioned = new Map<string, PositionedNode>();
  for (const node of order) {
    const row = rowsPerDepth.get(node.depth) ?? 0;
    rowsPerDepth.set(node.depth, row + 1);
    positioned.set(node.spanId, {
      node,
      x: node.depth * opts.colW,
      y: row * opts.rowH,
    });
  }

  const edges: PositionedEdge[] = [];
  for (const target of positioned.values()) {
    const parentId = target.node.parentSpanId;
    if (parentId === null) continue;
    const source = positioned.get(parentId);
    if (source === undefined) continue;
    const x1 = source.x + opts.nodeW;
    const y1 = source.y + opts.nodeH / 2;
    const x2 = target.x;
    const y2 = target.y + opts.nodeH / 2;
    const midX = (x1 + x2) / 2;
    edges.push({
      path: `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`,
      error: target.node.status === 'ERROR',
    });
  }

  const maxDepth = order.reduce((max, node) => Math.max(max, node.depth), 0);
  const maxRows = Math.max(1, ...rowsPerDepth.values());
  return {
    nodes: [...positioned.values()],
    edges,
    width: (maxDepth + 1) * opts.colW,
    height: maxRows * opts.rowH,
  };
}
