import type { BusinessFlow } from './flow-signature';
import type { TopologyGraph } from './types';

/**
 * Anomaly flagging (spec §9): unexpected cycles, error hotspots, latency-
 * dominant hops and failing flows, computed from already-distilled structures
 * — shared verbatim by the REST API (`/api/anomalies`), the UI and the MCP
 * agent, so every surface sees the same picture.
 */
export type AnomalyKind = 'service-cycle' | 'error-hotspot' | 'latency-dominant' | 'failing-flow';

export interface Anomaly {
  readonly kind: AnomalyKind;
  readonly severity: 'info' | 'warning' | 'critical';
  /** What the anomaly is about — a service, an edge, or a flow signature. */
  readonly subject: string;
  readonly detail: string;
}

export interface AnomalyThresholds {
  /** Edge error rate above this is a hotspot (default 0.1). */
  readonly errorRateWarning: number;
  /** ... and above this it is critical (default 0.5). */
  readonly errorRateCritical: number;
  /** An edge slower than mean + this many multiples of the mean is latency-dominant (default 3). */
  readonly latencyDominanceFactor: number;
  /** Flow error rate above this flags the flow (default 0.25). */
  readonly flowErrorRate: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  errorRateWarning: 0.1,
  errorRateCritical: 0.5,
  latencyDominanceFactor: 3,
  flowErrorRate: 0.25,
};

export function detectAnomalies(
  topology: TopologyGraph,
  flows: readonly BusinessFlow[],
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  for (const cycle of topology.cycles) {
    anomalies.push({
      kind: 'service-cycle',
      severity: 'info',
      subject: cycle.join(' → '),
      detail:
        `services form a loop (${cycle.join(' → ')} → ${cycle[0] ?? ''}) — legitimate in event ` +
        'choreography, but verify it terminates and is intentional',
    });
  }

  for (const edge of topology.edges) {
    if (edge.count === 0) continue;
    const errorRate = edge.errorCount / edge.count;
    if (errorRate >= thresholds.errorRateWarning) {
      anomalies.push({
        kind: 'error-hotspot',
        severity: errorRate >= thresholds.errorRateCritical ? 'critical' : 'warning',
        subject: `${edge.source} -[${edge.channel}]-> ${edge.target}`,
        detail: `${Math.round(errorRate * 100)}% of ${edge.count} deliveries fail on this hop`,
      });
    }
  }

  if (topology.edges.length >= 2) {
    const totalLatency = topology.edges.reduce((sum, edge) => sum + edge.avgDurationMs, 0);
    for (const edge of topology.edges) {
      // Baseline excludes the edge under test — an outlier must not drag the
      // mean toward itself and hide.
      const baseline = (totalLatency - edge.avgDurationMs) / (topology.edges.length - 1);
      if (baseline > 0 && edge.avgDurationMs >= baseline * thresholds.latencyDominanceFactor) {
        anomalies.push({
          kind: 'latency-dominant',
          severity: 'warning',
          subject: `${edge.source} -[${edge.channel}]-> ${edge.target}`,
          detail: `avg ${edge.avgDurationMs}ms vs ${Math.round(baseline)}ms across the other hops — this hop dominates end-to-end latency`,
        });
      }
    }
  }

  for (const flow of flows) {
    if (flow.traceCount >= 2 && flow.errorRate >= thresholds.flowErrorRate) {
      anomalies.push({
        kind: 'failing-flow',
        severity: flow.errorRate >= thresholds.errorRateCritical ? 'critical' : 'warning',
        subject: flow.signature,
        detail: `${Math.round(flow.errorRate * 100)}% of ${flow.traceCount} runs of this business flow fail`,
      });
    }
  }

  const severityRank = { critical: 0, warning: 1, info: 2 } as const;
  return anomalies.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.subject.localeCompare(b.subject)
  );
}
