import type { BusinessFlow } from './flow-signature';

/**
 * Business-flow change detection (the differentiator over log search): compare
 * the flows observed in two time windows by signature and report what
 * appeared, what disappeared, and what still runs but behaves differently
 * (error rate / latency / traffic share). Works on distilled signatures only,
 * so the result is safe for the UI and the LLM alike (B4).
 */
export interface FlowWindowSummary {
  readonly traceCount: number;
  readonly errorRate: number;
  readonly avgDurationMs: number;
  /** Share of the window's sampled traces this flow accounts for (0..1). */
  readonly trafficShare: number;
}

export type FlowChangeKind = 'added' | 'removed' | 'changed';

export interface FlowChange {
  readonly kind: FlowChangeKind;
  readonly signature: string;
  readonly services: readonly string[];
  readonly base: FlowWindowSummary | null;
  readonly head: FlowWindowSummary | null;
  /** head - base; null when the flow exists in only one window. */
  readonly errorRateDelta: number | null;
  readonly avgDurationDeltaMs: number | null;
  readonly trafficShareDelta: number | null;
  /** Why this flow was flagged, human- and LLM-readable. */
  readonly reasons: readonly string[];
}

export interface FlowsDiff {
  readonly changes: readonly FlowChange[];
  readonly unchangedCount: number;
}

export interface DiffThresholds {
  /** Absolute error-rate move that counts as a change (default 0.10). */
  readonly errorRateDelta: number;
  /** Relative latency move that counts as a change (default 0.5 = ±50%). */
  readonly durationRatio: number;
  /** Absolute traffic-share move that counts as a change (default 0.20). */
  readonly trafficShareDelta: number;
}

const DEFAULT_THRESHOLDS: DiffThresholds = {
  errorRateDelta: 0.1,
  durationRatio: 0.5,
  trafficShareDelta: 0.2,
};

function summarize(flow: BusinessFlow, windowTotal: number): FlowWindowSummary {
  return {
    traceCount: flow.traceCount,
    errorRate: flow.errorRate,
    avgDurationMs: flow.avgDurationMs,
    trafficShare: windowTotal > 0 ? flow.traceCount / windowTotal : 0,
  };
}

const severityRank: Record<FlowChangeKind, number> = { removed: 0, added: 1, changed: 2 };

export function diffBusinessFlows(
  base: readonly BusinessFlow[],
  head: readonly BusinessFlow[],
  thresholds: DiffThresholds = DEFAULT_THRESHOLDS
): FlowsDiff {
  const baseTotal = base.reduce((sum, flow) => sum + flow.traceCount, 0);
  const headTotal = head.reduce((sum, flow) => sum + flow.traceCount, 0);
  const baseBySignature = new Map(base.map((flow) => [flow.signature, flow]));
  const headBySignature = new Map(head.map((flow) => [flow.signature, flow]));

  const changes: FlowChange[] = [];
  let unchangedCount = 0;

  for (const flow of head) {
    const before = baseBySignature.get(flow.signature);
    const after = summarize(flow, headTotal);
    if (before === undefined) {
      changes.push({
        kind: 'added',
        signature: flow.signature,
        services: flow.services,
        base: null,
        head: after,
        errorRateDelta: null,
        avgDurationDeltaMs: null,
        trafficShareDelta: null,
        reasons: ['flow did not run in the base window'],
      });
      continue;
    }
    const beforeSummary = summarize(before, baseTotal);
    const reasons: string[] = [];
    const errorDelta = after.errorRate - beforeSummary.errorRate;
    if (Math.abs(errorDelta) >= thresholds.errorRateDelta) {
      reasons.push(
        `error rate moved ${(beforeSummary.errorRate * 100).toFixed(0)}% -> ${(after.errorRate * 100).toFixed(0)}%`
      );
    }
    if (beforeSummary.avgDurationMs > 0) {
      const ratio = after.avgDurationMs / beforeSummary.avgDurationMs;
      if (ratio >= 1 + thresholds.durationRatio || ratio <= 1 - thresholds.durationRatio) {
        reasons.push(
          `avg duration moved ${beforeSummary.avgDurationMs}ms -> ${after.avgDurationMs}ms`
        );
      }
    }
    const shareDelta = after.trafficShare - beforeSummary.trafficShare;
    if (Math.abs(shareDelta) >= thresholds.trafficShareDelta) {
      reasons.push(
        `traffic share moved ${(beforeSummary.trafficShare * 100).toFixed(0)}% -> ${(after.trafficShare * 100).toFixed(0)}%`
      );
    }
    if (reasons.length === 0) {
      unchangedCount += 1;
      continue;
    }
    changes.push({
      kind: 'changed',
      signature: flow.signature,
      services: flow.services,
      base: beforeSummary,
      head: after,
      errorRateDelta: errorDelta,
      avgDurationDeltaMs: after.avgDurationMs - beforeSummary.avgDurationMs,
      trafficShareDelta: shareDelta,
      reasons,
    });
  }

  for (const flow of base) {
    if (headBySignature.has(flow.signature)) continue;
    changes.push({
      kind: 'removed',
      signature: flow.signature,
      services: flow.services,
      base: summarize(flow, baseTotal),
      head: null,
      errorRateDelta: null,
      avgDurationDeltaMs: null,
      trafficShareDelta: null,
      reasons: ['flow stopped running in the head window'],
    });
  }

  changes.sort(
    (a, b) => severityRank[a.kind] - severityRank[b.kind] || a.signature.localeCompare(b.signature)
  );
  return { changes, unchangedCount };
}
