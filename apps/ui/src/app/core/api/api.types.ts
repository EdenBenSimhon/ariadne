/**
 * The UI's API contract is the `@ariadne/graph` contract — one source of
 * truth shared with `apps/api` (allowed by the platform:shared boundary).
 * Responses are trusted server output; validation lives server-side (B3).
 */
export type {
  AnomaliesResponse,
  Anomaly,
  BusinessFlow,
  CriticalPath,
  FlowChange,
  FlowsChangesResponse,
  FlowsResponse,
  Insight,
  InsightsResponse,
  ServiceSummary,
  SpanLogEntry,
  GraphSpan,
  LiveEvent,
  LiveEventKind,
  HeartbeatLiveEvent,
  RecentActivityResponse,
  TraceLiveEvent,
  Paginated,
  StatsSummary,
  TopologyEdge,
  TopologyGraph,
  TopologyNode,
  TraceDag,
  TraceDagNode,
  TraceDetail,
  TraceSummary,
} from '@ariadne/graph';
