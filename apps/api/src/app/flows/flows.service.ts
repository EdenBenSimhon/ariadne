import type { TenantId } from '@ariadne/protocol';
import {
  buildTraceDag,
  detectAnomalies,
  diffBusinessFlows,
  discoverBusinessFlows,
  type AnomaliesResponse,
  type FlowsChangesResponse,
  type FlowsResponse,
  type FlowTraceInput,
} from '@ariadne/graph';
import type { TraceReader } from '@ariadne/storage';
import { Inject, Injectable } from '@nestjs/common';
import { TRACE_READER } from '../storage/storage.module';
import { storedSpanToGraphSpan } from '../traces/traces.service';
import { TopologyService } from '../topology/topology.service';

export interface FlowsQuery {
  readonly sampleSize: number;
  readonly status?: 'ok' | 'error' | undefined;
  /** Optional sampling window — used by flow-change detection. */
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

export interface FlowChangesQuery {
  readonly sampleSize: number;
  /** Width of each comparison window; head = last N hours, base = the N hours before. */
  readonly windowHours: number;
}

/**
 * Business-flow discovery + anomaly flagging (spec §9/§11), served once by
 * the API so the UI and the MCP agent see the exact same picture.
 */
@Injectable()
export class FlowsService {
  constructor(
    @Inject(TRACE_READER) private readonly reader: TraceReader,
    private readonly topology: TopologyService
  ) {}

  async flows(tenantId: TenantId, query: FlowsQuery): Promise<FlowsResponse> {
    const rows = await this.reader.listTraces(tenantId, {
      limit: query.sampleSize,
      ...(query.status !== undefined ? { hasError: query.status === 'error' } : {}),
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
    });
    const inputs: FlowTraceInput[] = [];
    for (const row of rows.slice(0, query.sampleSize)) {
      const spans = await this.reader.getSpansForTrace(tenantId, row.traceId);
      const dag = buildTraceDag(row.traceId, spans.map(storedSpanToGraphSpan));
      inputs.push({
        traceId: row.traceId,
        durationMs: row.durationMs ?? Math.max(0, row.endTime.getTime() - row.startTime.getTime()),
        hasError: row.hasError,
        dag,
      });
    }
    return { sampledTraces: inputs.length, flows: discoverBusinessFlows(inputs) };
  }

  /**
   * Business-flow drift: what appeared, disappeared or changed behaviour
   * between the previous window and the current one. This is the product's
   * "the checkout flow lost its payment hop after the 14:00 deploy" answer.
   */
  async changes(tenantId: TenantId, query: FlowChangesQuery): Promise<FlowsChangesResponse> {
    const now = Date.now();
    const windowMs = query.windowHours * 3_600_000;
    const headWindow = { from: new Date(now - windowMs), to: new Date(now) };
    const baseWindow = { from: new Date(now - 2 * windowMs), to: new Date(now - windowMs) };
    const [base, head] = await Promise.all([
      this.flows(tenantId, { sampleSize: query.sampleSize, ...baseWindow }),
      this.flows(tenantId, { sampleSize: query.sampleSize, ...headWindow }),
    ]);
    const diff = diffBusinessFlows(base.flows, head.flows);
    return {
      base: {
        from: baseWindow.from.toISOString(),
        to: baseWindow.to.toISOString(),
        sampledTraces: base.sampledTraces,
      },
      head: {
        from: headWindow.from.toISOString(),
        to: headWindow.to.toISOString(),
        sampledTraces: head.sampledTraces,
      },
      changes: diff.changes,
      unchangedCount: diff.unchangedCount,
    };
  }

  async anomalies(tenantId: TenantId, query: FlowsQuery): Promise<AnomaliesResponse> {
    const [topology, flows] = await Promise.all([
      this.topology.topology(tenantId, {}),
      this.flows(tenantId, query),
    ]);
    return {
      sampledTraces: flows.sampledTraces,
      anomalies: detectAnomalies(topology, flows.flows),
    };
  }
}
