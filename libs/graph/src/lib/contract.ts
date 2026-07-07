import type { TraceId } from '@ariadne/protocol';
import type { CriticalPath, GraphSpan, TraceDag } from './types';

/**
 * API read-model DTOs (spec §8). Plain interfaces, not zod: responses are
 * trusted server output — validation lives at the inputs (B3). These are the
 * contract both `apps/api` (producer) and `apps/ui` (consumer) import.
 */
export interface TraceSummary {
  readonly traceId: TraceId;
  readonly rootService: string | null;
  readonly spanCount: number;
  /** ISO timestamps on the wire. */
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMs: number;
  readonly hasError: boolean;
}

export interface Paginated<T> {
  readonly items: readonly T[];
  /** Keyset cursor for the next page; null when this is the last page. */
  readonly nextCursor: string | null;
}

export interface TraceDetail {
  readonly trace: TraceSummary;
  readonly spans: readonly GraphSpan[];
  readonly dag: TraceDag;
  readonly criticalPath: CriticalPath;
}

export interface FlowsResponse {
  readonly sampledTraces: number;
  readonly flows: readonly import('./flow-signature').BusinessFlow[];
}

export interface AnomaliesResponse {
  readonly sampledTraces: number;
  readonly anomalies: readonly import('./anomalies').Anomaly[];
}

/** `/api/flows/changes` — business-flow drift between two time windows. */
export interface FlowsChangesResponse {
  readonly base: { readonly from: string; readonly to: string; readonly sampledTraces: number };
  readonly head: { readonly from: string; readonly to: string; readonly sampledTraces: number };
  readonly changes: readonly import('./diff-flows').FlowChange[];
  readonly unchangedCount: number;
}

/** `/api/spans` — one log line in the logger-style search view. */
export interface SpanLogEntry {
  readonly traceId: TraceId;
  readonly spanId: string;
  readonly serviceName: string;
  readonly spanKind: string;
  readonly transport: string;
  readonly channel: string;
  readonly operationName: string;
  /** ISO timestamp on the wire. */
  readonly startTime: string;
  readonly durationMs: number;
  readonly status: 'OK' | 'ERROR';
  readonly error: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>> | null;
}

/** `/api/services` — per-service aggregate for the queried window. */
export interface ServiceSummary {
  readonly serviceName: string;
  readonly spanCount: number;
  readonly errorCount: number;
  readonly errorRate: number;
  readonly avgDurationMs: number | null;
  readonly p95DurationMs: number | null;
  readonly channels: readonly string[];
}

/** `/api/insights` — persisted agent/user conclusions about the trace data. */
export interface Insight {
  readonly insightId: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly traceIds: readonly string[];
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface InsightsResponse {
  readonly items: readonly Insight[];
}

/** Alerting (`/api/alerts/*`) — rules watch the system, events record breaches. */
export type AlertRuleKind =
  | 'error-rate'
  | 'latency-p95'
  | 'flow-missing'
  | 'flow-drift'
  | 'service-silent';

export interface AlertRule {
  readonly ruleId: string;
  readonly name: string;
  readonly kind: AlertRuleKind;
  readonly enabled: boolean;
  readonly config: Readonly<Record<string, string | number>>;
  readonly webhookUrl: string | null;
  readonly lastState: 'ok' | 'breach';
  readonly createdAt: string;
}

export interface AlertEvent {
  readonly eventId: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly kind: string;
  readonly message: string;
  readonly context: Readonly<Record<string, string | number>>;
  readonly firedAt: string;
  readonly acknowledged: boolean;
}

export interface AlertRulesResponse {
  readonly items: readonly AlertRule[];
}

export interface AlertEventsResponse {
  readonly items: readonly AlertEvent[];
}

/** `/api/stats/timeseries` — bucketed activity for dashboards. */
export interface StatsBucket {
  readonly bucketStart: string;
  readonly traceCount: number;
  readonly errorTraceCount: number;
  readonly p95DurationMs: number | null;
}

export interface StatsTimeseriesResponse {
  readonly bucketMinutes: number;
  readonly from: string;
  readonly to: string;
  readonly buckets: readonly StatsBucket[];
}

export interface StatsSummary {
  readonly traceCount: number;
  readonly errorTraceCount: number;
  readonly errorRate: number;
  readonly spanCount: number;
  readonly serviceCount: number;
  readonly avgDurationMs: number | null;
  readonly p50DurationMs: number | null;
  readonly p95DurationMs: number | null;
  /** The resolved query window, echoed back. */
  readonly from: string;
  readonly to: string;
}

/**
 * Live activity (SSE `/api/events`, snapshot `/api/events/recent`, MCP
 * `get_recent_activity`). Distilled by construction — a completed trace's
 * summary, never raw spans or payloads — so the same event is safe for the UI,
 * an SSE client and the LLM alike (security B4).
 */
export type LiveEventKind = 'trace' | 'heartbeat';

export interface TraceLiveEvent {
  readonly kind: 'trace';
  /** ISO time the event was observed/replayed. */
  readonly at: string;
  readonly trace: TraceSummary;
}

/** Keepalive so proxies don't drop an idle SSE connection. */
export interface HeartbeatLiveEvent {
  readonly kind: 'heartbeat';
  readonly at: string;
}

export type LiveEvent = TraceLiveEvent | HeartbeatLiveEvent;

/** Non-streaming recent activity — the "what just happened / any errors?" log. */
export interface RecentActivityResponse {
  readonly events: readonly TraceLiveEvent[];
}
