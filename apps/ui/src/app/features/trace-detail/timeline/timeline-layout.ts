import type { TraceDag, TraceDagNode } from '@ariadne/graph';

/**
 * Pure timeline layout: DAG → indented Gantt rows in DFS order. The API has
 * already computed depths and offsets; this only converts to percentages and
 * flattens the forest deterministically. A visited guard keeps corrupt child
 * links from looping.
 */
export interface TimelineRow {
  readonly node: TraceDagNode;
  readonly leftPct: number;
  readonly widthPct: number;
}

const MIN_WIDTH_PCT = 0.4;

export function computeTimelineRows(dag: TraceDag): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const total = Math.max(1, dag.durationMs);
  const visited = new Set<string>();

  const visit = (spanId: string): void => {
    if (visited.has(spanId)) return;
    visited.add(spanId);
    const node = dag.nodes[spanId];
    if (node === undefined) return;
    const leftPct = Math.min(100, (node.startOffsetMs / total) * 100);
    const widthPct = Math.max(
      MIN_WIDTH_PCT,
      Math.min(100 - leftPct, (node.durationMs / total) * 100)
    );
    rows.push({ node, leftPct, widthPct });
    for (const child of node.children) visit(child);
  };

  for (const root of dag.roots) visit(root);
  return rows;
}

/** 5 evenly spaced axis ticks labelled in ms from trace start. */
export function computeAxisTicks(durationMs: number): Array<{ leftPct: number; label: string }> {
  const ticks: Array<{ leftPct: number; label: string }> = [];
  for (let i = 0; i <= 4; i += 1) {
    ticks.push({ leftPct: i * 25, label: `${Math.round((durationMs * i) / 4)}ms` });
  }
  return ticks;
}
