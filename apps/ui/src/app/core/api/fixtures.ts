import type { SpanId, TraceId } from '@ariadne/protocol';
import {
  buildTopology,
  buildTraceDag,
  computeCriticalPath,
  type GraphSpan,
  type Paginated,
  type StatsSummary,
  type TopologyGraph,
  type TopologySpan,
  type TraceDetail,
  type TraceSummary,
} from '@ariadne/graph';

/**
 * Dev/test fixtures: the spec §1 worked example (POST /orders → 6 spans),
 * built with the real graph algorithms so fixtures can never drift from the
 * API's actual response shapes.
 */
export const FIXTURE_TRACE_ID = 'f'.repeat(32) as TraceId;
const BASE = Date.parse('2026-07-06T10:00:00.000Z');

const sid = (n: number): SpanId => n.toString(16).padStart(16, '0') as SpanId;

const hop = (
  n: number,
  parent: number | null,
  serviceName: string,
  spanKind: 'PRODUCER' | 'CONSUMER',
  channel: string,
  failed = false
): GraphSpan => ({
  spanId: sid(n),
  parentSpanId: parent === null ? null : sid(parent),
  serviceName,
  spanKind,
  transport: 'kafka',
  channel,
  operationName: `${spanKind === 'PRODUCER' ? 'publish' : 'consume'} ${channel}`,
  startTimeMs: BASE + n * 60,
  durationMs: 40 + n * 15,
  status: failed ? 'ERROR' : 'OK',
  error: failed ? 'Error: card declined' : null,
  metadata: {
    orderId: 'ord-1042',
    customerId: 'cust-7',
    productId: 'widget-blue',
    quantity: 2,
    ...(channel.startsWith('payment') ? { amount: 200 } : {}),
    ...(failed ? { reason: 'card declined' } : {}),
  },
});

export const FIXTURE_SPANS: readonly GraphSpan[] = [
  hop(1, null, 'order-service', 'PRODUCER', 'orders.created'),
  hop(2, 1, 'inventory-service', 'CONSUMER', 'orders.created'),
  hop(3, 2, 'inventory-service', 'PRODUCER', 'inventory.reserved'),
  hop(4, 3, 'payment-service', 'CONSUMER', 'inventory.reserved'),
  hop(5, 4, 'payment-service', 'PRODUCER', 'payment.completed', true),
  hop(6, 5, 'order-service', 'CONSUMER', 'payment.completed'),
];

const dag = buildTraceDag(FIXTURE_TRACE_ID, FIXTURE_SPANS);

export const FIXTURE_TRACE_SUMMARY: TraceSummary = {
  traceId: FIXTURE_TRACE_ID,
  rootService: 'order-service',
  spanCount: FIXTURE_SPANS.length,
  startTime: new Date(dag.startTimeMs).toISOString(),
  endTime: new Date(dag.startTimeMs + dag.durationMs).toISOString(),
  durationMs: dag.durationMs,
  hasError: true,
};

export const FIXTURE_TRACE_DETAIL: TraceDetail = {
  trace: FIXTURE_TRACE_SUMMARY,
  spans: FIXTURE_SPANS,
  dag,
  criticalPath: computeCriticalPath(dag),
};

export const FIXTURE_TRACE_LIST: Paginated<TraceSummary> = {
  items: [FIXTURE_TRACE_SUMMARY],
  nextCursor: null,
};

export const FIXTURE_TOPOLOGY: TopologyGraph = buildTopology(
  FIXTURE_SPANS.map((span): TopologySpan => ({ ...span, traceId: FIXTURE_TRACE_ID }))
);

export const FIXTURE_STATS: StatsSummary = {
  traceCount: 1,
  errorTraceCount: 1,
  errorRate: 1,
  spanCount: 6,
  serviceCount: 3,
  avgDurationMs: dag.durationMs,
  p50DurationMs: dag.durationMs,
  p95DurationMs: dag.durationMs,
  from: new Date(BASE - 3_600_000).toISOString(),
  to: new Date(BASE).toISOString(),
};
