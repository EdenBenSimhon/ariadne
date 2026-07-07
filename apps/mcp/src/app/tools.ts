import { traceIdSchema } from '@ariadne/protocol';
import type {
  AlertEventsResponse,
  AlertRule,
  AnomaliesResponse,
  FlowsChangesResponse,
  FlowsResponse,
  Insight,
  InsightsResponse,
  Paginated,
  RecentActivityResponse,
  ServiceSummary,
  SpanLogEntry,
  StatsSummary,
  TopologyGraph,
  TraceDetail,
  TraceSummary,
} from '@ariadne/graph';
import type { ApiClient } from './api-client';
import { distillLogLine, distillTraceFlow, sanitize, sanitizeMetadata } from './distill';

/**
 * Read-only, tenant-scoped MCP tools over the distilled trace graph
 * (spec §9 / security B4). Definitions are plain data so handlers are
 * unit-testable without the MCP SDK.
 */
export interface McpToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly handler: (client: ApiClient, args: Record<string, unknown>) => Promise<unknown>;
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function statusParam(raw: unknown): string {
  return raw === 'error' ? '&status=error' : raw === 'ok' ? '&status=ok' : '';
}

/** Bounded lookback for log-search tools; ISO from/to pair. */
function windowParams(sinceMinutesRaw: unknown, fallbackMinutes: number): string {
  const minutes = clampLimit(sinceMinutesRaw, fallbackMinutes, 7 * 24 * 60);
  const to = new Date();
  const from = new Date(to.getTime() - minutes * 60_000);
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
}

function optionalParam(name: string, raw: unknown, maxLen = 200): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  return `&${name}=${encodeURIComponent(raw.slice(0, maxLen))}`;
}

/** Digits and long hex runs collapse so "order 123 failed" and "order 456 failed" cluster. */
function normalizeErrorPattern(error: string): string {
  return sanitize(error, 160)
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/g, '*')
    .replace(/\d+/g, '#');
}

function requireTraceId(raw: unknown): string {
  const parsed = traceIdSchema.safeParse(raw);
  if (!parsed.success) throw new Error('traceId must be 32 lowercase hex characters');
  return parsed.data;
}

export const mcpTools: readonly McpToolDef[] = [
  {
    name: 'list_traces',
    description:
      'List recent traces (newest first): root service, span count, duration, error flag. ' +
      "Filter with status: 'ok' | 'error'.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'max traces to return (1-100, default 20)' },
        status: { type: 'string', enum: ['ok', 'error'] },
      },
    },
    handler: async (client, args) => {
      const limit = clampLimit(args['limit'], 20, 100);
      const page = await client.get<Paginated<TraceSummary>>(
        `/traces?limit=${limit}${statusParam(args['status'])}`
      );
      return page.items;
    },
  },
  {
    name: 'get_trace_flow',
    description:
      'Get one trace as a DISTILLED flow: service hops, critical path, errors, cycles. ' +
      'Raw spans and payload metadata are never included.',
    inputSchema: {
      type: 'object',
      properties: {
        traceId: { type: 'string', description: '32-hex trace id' },
      },
      required: ['traceId'],
    },
    handler: async (client, args) => {
      const parsed = traceIdSchema.safeParse(args['traceId']);
      if (!parsed.success) throw new Error('traceId must be 32 lowercase hex characters');
      const detail = await client.get<TraceDetail>(`/traces/${parsed.data}`);
      return distillTraceFlow(detail);
    },
  },
  {
    name: 'get_topology',
    description:
      'The aggregated service topology: which services talk to which, over which channels, ' +
      'with call counts, average latency, error counts and any service-level loops.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (client) => client.get<TopologyGraph>('/topology'),
  },
  {
    name: 'get_stats',
    description: 'Tenant-wide stats for the recent window: trace/span counts, error rate, p50/p95 latency.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (client) => client.get<StatsSummary>('/stats'),
  },
  {
    name: 'discover_business_flows',
    description:
      'Discover the business processes that actually run: clusters recent traces by their ' +
      'service/channel hop signature and returns each distinct flow with frequency, error rate ' +
      'and average duration. Use this to name and explain the emergent choreography. ' +
      'Served by the same API endpoint the UI Flows page uses.',
    inputSchema: {
      type: 'object',
      properties: {
        sampleSize: { type: 'number', description: 'traces to sample (1-100, default 50)' },
        status: { type: 'string', enum: ['ok', 'error'] },
      },
    },
    handler: async (client, args) => {
      const sampleSize = clampLimit(args['sampleSize'], 50, 100);
      return client.get<FlowsResponse>(
        `/flows?sampleSize=${sampleSize}${statusParam(args['status'])}`
      );
    },
  },
  {
    name: 'find_anomalies',
    description:
      'Flag anomalies in the observed system: unexpected service cycles, error hotspots on ' +
      'specific hops, latency-dominant hops, and failing business flows — ordered by severity.',
    inputSchema: {
      type: 'object',
      properties: {
        sampleSize: { type: 'number', description: 'traces to sample for flow analysis (1-100, default 50)' },
      },
    },
    handler: async (client, args) => {
      const sampleSize = clampLimit(args['sampleSize'], 50, 100);
      return client.get<AnomaliesResponse>(`/anomalies?sampleSize=${sampleSize}`);
    },
  },
  {
    name: 'get_recent_activity',
    description:
      'Recent activity log: the last N completed traces (newest first) with root service, ' +
      'status (ok/error), span count and duration — the "what just happened / anything failing ' +
      'right now?" view. This is the same live feed the UI Live tab streams over SSE. Use it to ' +
      'answer questions about current behaviour and recent failures. Distilled summaries only — ' +
      'no raw spans or payloads.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'events to return (1-100, default 25)' },
      },
    },
    handler: async (client, args) => {
      const limit = clampLimit(args['limit'], 25, 100);
      const activity = await client.get<RecentActivityResponse>(`/events/recent?limit=${limit}`);
      return activity.events;
    },
  },
  {
    name: 'search_logs',
    description:
      'Search the span log like a log viewer: free text (matches operation, channel and error ' +
      'message) plus structured filters — service, channel, status, transport, minimum duration ' +
      'and metadata key/value. Returns distilled log lines newest first, including redacted ' +
      'business metadata (orderId, region, ...). Use this to inspect WHAT the system logged; ' +
      'use flow tools to reason about HOW it behaved.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'free text over operation/channel/error' },
        service: { type: 'string' },
        channel: { type: 'string' },
        status: { type: 'string', enum: ['ok', 'error'] },
        transport: { type: 'string', enum: ['kafka', 'rabbitmq', 'rest'] },
        minDurationMs: { type: 'number', description: 'only spans at least this slow' },
        metaKey: { type: 'string', description: 'metadata key that must exist' },
        metaValue: { type: 'string', description: 'value metaKey must equal' },
        sinceMinutes: { type: 'number', description: 'lookback window (default 60, max 10080)' },
        limit: { type: 'number', description: 'max log lines (1-100, default 50)' },
      },
    },
    handler: async (client, args) => {
      const limit = clampLimit(args['limit'], 50, 100);
      let path = `/spans?limit=${limit}&${windowParams(args['sinceMinutes'], 60)}`;
      path += optionalParam('q', args['q']);
      path += optionalParam('service', args['service']);
      path += optionalParam('channel', args['channel']);
      path += args['status'] === 'error' ? '&status=ERROR' : args['status'] === 'ok' ? '&status=OK' : '';
      path += optionalParam('transport', args['transport']);
      if (typeof args['minDurationMs'] === 'number' && args['minDurationMs'] > 0) {
        path += `&minDurationMs=${Math.floor(args['minDurationMs'])}`;
      }
      path += optionalParam('metaKey', args['metaKey'], 64);
      path += optionalParam('metaValue', args['metaValue'], 256);
      const page = await client.get<Paginated<SpanLogEntry>>(path);
      return {
        count: page.items.length,
        hasMore: page.nextCursor !== null,
        logs: page.items.map(distillLogLine),
      };
    },
  },
  {
    name: 'get_span_metadata',
    description:
      'The redacted business metadata attached to every span of one trace (orderId, amounts, ' +
      'flags, ...). Use this to conclude what DATA moved through a flow and how it changed hop ' +
      'by hop — e.g. an amount that differs between the payment and billing spans.',
    inputSchema: {
      type: 'object',
      properties: { traceId: { type: 'string', description: '32-hex trace id' } },
      required: ['traceId'],
    },
    handler: async (client, args) => {
      const traceId = requireTraceId(args['traceId']);
      const detail = await client.get<{ items: SpanLogEntry[] }>(`/traces/${traceId}/spans`);
      return detail.items.map((span) => ({
        time: span.startTime,
        service: sanitize(span.serviceName, 128),
        channel: sanitize(span.channel, 128),
        operation: sanitize(span.operationName, 128),
        status: span.status,
        metadata: sanitizeMetadata(span.metadata),
      }));
    },
  },
  {
    name: 'analyze_service',
    description:
      'Deep-dive one service: span volume, error rate, latency (avg/p95), the channels it ' +
      'touches and its most recent errors — a ready-made health conclusion for that service.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'exact service name' },
        sinceMinutes: { type: 'number', description: 'lookback window (default 1440 = 24h)' },
      },
      required: ['service'],
    },
    handler: async (client, args) => {
      const serviceRaw = typeof args['service'] === 'string' ? args['service'] : '';
      if (serviceRaw.length === 0) throw new Error('service is required');
      const window = windowParams(args['sinceMinutes'], 1_440);
      const services = await client.get<ServiceSummary[]>(`/services?${window}`);
      const summary = services.find((entry) => entry.serviceName === serviceRaw);
      if (summary === undefined) {
        return {
          found: false,
          knownServices: services.map((entry) => sanitize(entry.serviceName, 128)),
        };
      }
      const errorPage = await client.get<Paginated<SpanLogEntry>>(
        `/spans?limit=20&status=ERROR&${window}${optionalParam('service', serviceRaw)}`
      );
      return {
        found: true,
        service: sanitize(summary.serviceName, 128),
        spanCount: summary.spanCount,
        errorCount: summary.errorCount,
        errorRate: summary.errorRate,
        avgDurationMs: summary.avgDurationMs,
        p95DurationMs: summary.p95DurationMs,
        channels: summary.channels.map((channel) => sanitize(channel, 128)),
        recentErrors: errorPage.items.map(distillLogLine),
      };
    },
  },
  {
    name: 'error_breakdown',
    description:
      'Cluster recent errors into patterns: groups error spans by service, channel and ' +
      'normalized message (ids/numbers collapsed), so 500 similar failures read as one line ' +
      'with a count, first/last seen and example trace ids. Start here for "what is failing?".',
    inputSchema: {
      type: 'object',
      properties: {
        sinceMinutes: { type: 'number', description: 'lookback window (default 1440 = 24h)' },
      },
    },
    handler: async (client, args) => {
      const page = await client.get<Paginated<SpanLogEntry>>(
        `/spans?limit=100&status=ERROR&${windowParams(args['sinceMinutes'], 1_440)}`
      );
      const groups = new Map<
        string,
        {
          service: string;
          channel: string;
          pattern: string;
          count: number;
          firstSeen: string;
          lastSeen: string;
          exampleTraceIds: string[];
        }
      >();
      for (const span of page.items) {
        const pattern = normalizeErrorPattern(span.error ?? 'unknown');
        const key = `${span.serviceName}|${span.channel}|${pattern}`;
        const group = groups.get(key) ?? {
          service: sanitize(span.serviceName, 128),
          channel: sanitize(span.channel, 128),
          pattern,
          count: 0,
          firstSeen: span.startTime,
          lastSeen: span.startTime,
          exampleTraceIds: [],
        };
        group.count += 1;
        if (span.startTime < group.firstSeen) group.firstSeen = span.startTime;
        if (span.startTime > group.lastSeen) group.lastSeen = span.startTime;
        if (group.exampleTraceIds.length < 3 && !group.exampleTraceIds.includes(span.traceId)) {
          group.exampleTraceIds.push(span.traceId);
        }
        groups.set(key, group);
      }
      return {
        sampledErrorSpans: page.items.length,
        truncated: page.nextCursor !== null,
        patterns: [...groups.values()].sort((a, b) => b.count - a.count),
      };
    },
  },
  {
    name: 'compare_traces',
    description:
      'Structural diff of two traces: hops that only one of them has, duration and status ' +
      'deltas. Use it to explain "this order worked, that one did not" — same intended flow, ' +
      'different actual path.',
    inputSchema: {
      type: 'object',
      properties: {
        traceIdA: { type: 'string', description: '32-hex trace id (baseline)' },
        traceIdB: { type: 'string', description: '32-hex trace id (comparison)' },
      },
      required: ['traceIdA', 'traceIdB'],
    },
    handler: async (client, args) => {
      const idA = requireTraceId(args['traceIdA']);
      const idB = requireTraceId(args['traceIdB']);
      const [a, b] = await Promise.all([
        client.get<TraceDetail>(`/traces/${idA}`).then(distillTraceFlow),
        client.get<TraceDetail>(`/traces/${idB}`).then(distillTraceFlow),
      ]);
      const hopsA = new Set(a.hops);
      const hopsB = new Set(b.hops);
      return {
        a,
        b,
        sameFlow: a.signature === b.signature,
        hopsOnlyInA: a.hops.filter((hop) => !hopsB.has(hop)),
        hopsOnlyInB: b.hops.filter((hop) => !hopsA.has(hop)),
        durationDeltaMs: b.durationMs - a.durationMs,
        statusChange: a.status === b.status ? null : `${a.status} -> ${b.status}`,
      };
    },
  },
  {
    name: 'compare_flow_windows',
    description:
      'Business-flow change detection: compares the flows observed in the last windowHours ' +
      'against the windowHours before that, and reports flows that APPEARED, DISAPPEARED or ' +
      'CHANGED behaviour (error rate, latency, traffic share) with reasons. The go-to tool for ' +
      '"what changed since yesterday / since the deploy?".',
    inputSchema: {
      type: 'object',
      properties: {
        windowHours: { type: 'number', description: 'width of each window in hours (default 24, max 168)' },
        sampleSize: { type: 'number', description: 'traces sampled per window (1-100, default 50)' },
      },
    },
    handler: async (client, args) => {
      const windowHours = clampLimit(args['windowHours'], 24, 168);
      const sampleSize = clampLimit(args['sampleSize'], 50, 100);
      return client.get<FlowsChangesResponse>(
        `/flows/changes?windowHours=${windowHours}&sampleSize=${sampleSize}`
      );
    },
  },
  {
    name: 'save_insight',
    description:
      'Persist a conclusion you reached about the system (it appears on the Insights page and ' +
      'survives this conversation). Use it AFTER analysis when you found something durable: a ' +
      'flow change, an error pattern, an anomaly, or a notable observation. Reference the trace ' +
      'ids that evidence the conclusion.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['flow-change', 'error-pattern', 'anomaly', 'observation'] },
        title: { type: 'string', description: 'one-line summary (max 256 chars)' },
        body: { type: 'string', description: 'the conclusion with evidence (max 4000 chars)' },
        traceIds: { type: 'array', items: { type: 'string' }, description: 'up to 20 evidencing trace ids' },
      },
      required: ['kind', 'title', 'body'],
    },
    handler: async (client, args) => {
      const rawTraceIds = Array.isArray(args['traceIds']) ? args['traceIds'] : [];
      const traceIds = rawTraceIds
        .map((id) => traceIdSchema.safeParse(id))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data)
        .slice(0, 20);
      const saved = await client.post<Insight>('/insights', {
        kind: args['kind'],
        title: args['title'],
        body: args['body'],
        traceIds,
        createdBy: 'agent',
      });
      return { saved: true, insightId: saved.insightId, title: saved.title };
    },
  },
  {
    name: 'list_insights',
    description:
      'Previously saved conclusions (yours and the team\'s), newest first. Check here before ' +
      're-analyzing — a question may already have a persisted answer worth building on.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'max insights (1-100, default 20)' },
      },
    },
    handler: async (client, args) => {
      const limit = clampLimit(args['limit'], 20, 100);
      const response = await client.get<InsightsResponse>(`/insights?limit=${limit}`);
      return response.items.map((insight) => ({
        insightId: insight.insightId,
        kind: insight.kind,
        title: sanitize(insight.title, 256),
        body: sanitize(insight.body, 1_000),
        traceIds: insight.traceIds,
        createdBy: insight.createdBy,
        createdAt: insight.createdAt,
      }));
    },
  },
  {
    name: 'create_alert_rule',
    description:
      'Create a standing watch on the system. Kinds: error-rate (config: threshold 0-1, ' +
      'windowMinutes), latency-p95 (config: thresholdMs, windowMinutes), flow-missing (config: ' +
      'signature — the exact flow signature that must keep running, windowMinutes), flow-drift ' +
      '(config: windowHours), service-silent (config: service, windowMinutes). Use when the ' +
      'user asks to be told/alerted/watched about something — e.g. "watch the checkout flow" → ' +
      'flow-missing with that flow\'s signature.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'human-readable rule name' },
        kind: {
          type: 'string',
          enum: ['error-rate', 'latency-p95', 'flow-missing', 'flow-drift', 'service-silent'],
        },
        config: { type: 'object', description: 'kind-specific settings, see the kind list' },
      },
      required: ['name', 'kind', 'config'],
    },
    handler: async (client, args) => {
      const rule = await client.post<AlertRule>('/alerts/rules', {
        name: args['name'],
        kind: args['kind'],
        config: args['config'] ?? {},
      });
      return { created: true, ruleId: rule.ruleId, name: rule.name, kind: rule.kind, config: rule.config };
    },
  },
  {
    name: 'list_alert_events',
    description:
      'Fired alerts, newest first: which rule fired, why (message + observed values) and when. ' +
      'Check this for "did anything alert / is anything wrong right now?" before deep analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'max events (1-100, default 20)' },
      },
    },
    handler: async (client, args) => {
      const limit = clampLimit(args['limit'], 20, 100);
      const response = await client.get<AlertEventsResponse>(`/alerts/events?limit=${limit}`);
      return response.items.map((event) => ({
        firedAt: event.firedAt,
        rule: sanitize(event.ruleName, 128),
        kind: event.kind,
        message: sanitize(event.message, 500),
        acknowledged: event.acknowledged,
      }));
    },
  },
];
