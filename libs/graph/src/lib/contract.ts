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
