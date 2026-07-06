import { traceIdSchema } from '@ariadne/protocol';
import {
  discoverBusinessFlows,
  type FlowTraceInput,
  type Paginated,
  type StatsSummary,
  type TopologyGraph,
  type TraceDetail,
  type TraceSummary,
} from '@ariadne/graph';
import type { ApiClient } from './api-client';
import { distillTraceFlow } from './distill';

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
      'and average duration. Use this to name and explain the emergent choreography.',
    inputSchema: {
      type: 'object',
      properties: {
        sampleSize: { type: 'number', description: 'traces to sample (1-50, default 25)' },
        status: { type: 'string', enum: ['ok', 'error'] },
      },
    },
    handler: async (client, args) => {
      const sampleSize = clampLimit(args['sampleSize'], 25, 50);
      const page = await client.get<Paginated<TraceSummary>>(
        `/traces?limit=${sampleSize}${statusParam(args['status'])}`
      );
      const inputs: FlowTraceInput[] = [];
      for (const summary of page.items) {
        const detail = await client.get<TraceDetail>(`/traces/${summary.traceId}`);
        inputs.push({
          traceId: detail.trace.traceId,
          durationMs: detail.trace.durationMs,
          hasError: detail.trace.hasError,
          dag: detail.dag,
        });
      }
      return {
        sampledTraces: inputs.length,
        flows: discoverBusinessFlows(inputs),
      };
    },
  },
];
