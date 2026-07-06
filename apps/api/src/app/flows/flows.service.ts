import type { TenantId } from '@ariadne/protocol';
import {
  buildTraceDag,
  detectAnomalies,
  discoverBusinessFlows,
  type AnomaliesResponse,
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
