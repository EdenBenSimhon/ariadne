import type {
  Metadata,
  SpanId,
  SpanKind,
  SpanStatus,
  TraceId,
  TransportKind,
} from '@ariadne/protocol';

/**
 * Graph shapes (spec §11: "the domain is a graph — the algorithms are the
 * product"). Everything here is readonly, JSON-serializable and browser-safe:
 * these types ARE the API response contract the Angular UI consumes.
 * Times are epoch/relative milliseconds — graph math needs numbers.
 */

/** Structural input — a stored span with dates flattened to epoch ms. */
export interface GraphSpan {
  readonly spanId: SpanId;
  readonly parentSpanId: SpanId | null;
  readonly serviceName: string;
  readonly spanKind: SpanKind;
  readonly transport: TransportKind;
  readonly channel: string;
  readonly operationName: string;
  readonly startTimeMs: number;
  readonly durationMs: number;
  readonly status: SpanStatus;
  readonly error: string | null;
  /** Allowlist-redacted message fields captured at source (flat primitives). */
  readonly metadata: Metadata | null;
}

/** Topology aggregates across traces, so its input also carries the traceId. */
export interface TopologySpan extends GraphSpan {
  readonly traceId: TraceId;
}

export interface TraceDagNode {
  readonly spanId: SpanId;
  readonly parentSpanId: SpanId | null;
  /** Sorted by startOffsetMs. */
  readonly children: readonly SpanId[];
  readonly serviceName: string;
  readonly spanKind: SpanKind;
  readonly transport: TransportKind;
  readonly channel: string;
  readonly operationName: string;
  /** Relative to the trace start — timeline-ready, no date math in the UI. */
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly status: SpanStatus;
  readonly error: string | null;
  readonly depth: number;
  /** parentSpanId is set but the parent never arrived (partial trace). */
  readonly orphaned: boolean;
  /** Allowlist-redacted message fields captured at source (flat primitives). */
  readonly metadata: Metadata | null;
}

/**
 * A trace as a forest: true roots plus orphan subtree roots. No synthetic
 * root nodes — partial traces are represented honestly and the UI flags them.
 */
export interface TraceDag {
  readonly traceId: TraceId;
  /** Keyed by spanId — O(1) lookup, JSON-safe. */
  readonly nodes: Readonly<Record<string, TraceDagNode>>;
  /** True roots first (by start offset), then orphan roots. */
  readonly roots: readonly SpanId[];
  readonly orphanCount: number;
  readonly startTimeMs: number;
  readonly durationMs: number;
  /** Span-level loops from forged/corrupt parent ids; [] on healthy data. */
  readonly cycles: readonly (readonly SpanId[])[];
}

export interface CriticalPath {
  /** Root-first chain of the latest-finishing path in the forest. */
  readonly spanIds: readonly SpanId[];
  /** Finish time of the path, relative to the trace start. */
  readonly durationMs: number;
}

export interface TopologyNode {
  readonly service: string;
  readonly spanCount: number;
  readonly errorCount: number;
}

/** One service-to-service hop over a channel, aggregated across traces. */
export interface TopologyEdge {
  readonly source: string;
  readonly target: string;
  readonly channel: string;
  readonly transport: TransportKind;
  readonly count: number;
  /** Average duration of the receiving (child) spans. */
  readonly avgDurationMs: number;
  readonly errorCount: number;
}

export interface TopologyGraph {
  readonly nodes: readonly TopologyNode[];
  readonly edges: readonly TopologyEdge[];
  /** Service-level loops (A→B→A) — legitimate in EDA, surfaced not rejected. */
  readonly cycles: readonly (readonly string[])[];
  /** The span-row cap was hit; the picture is partial (UI shows a banner). */
  readonly truncated: boolean;
}
