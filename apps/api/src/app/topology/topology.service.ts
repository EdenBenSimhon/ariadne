import type { TenantId } from '@ariadne/protocol';
import { buildTopology, type TopologyGraph, type TopologySpan } from '@ariadne/graph';
import type { TopologySpanRow, TraceReader } from '@ariadne/storage';
import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { resolveWindow, type WindowQuery } from '../common/query';
import { TRACE_READER } from '../storage/storage.module';

function toTopologySpan(row: TopologySpanRow): TopologySpan {
  return {
    traceId: row.traceId,
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    serviceName: row.serviceName,
    spanKind: row.spanKind,
    transport: row.transport,
    channel: row.channel,
    operationName: row.operationName,
    startTimeMs: row.startTime.getTime(),
    durationMs: row.durationMs,
    status: row.status,
    error: row.error,
  };
}

/**
 * Aggregation happens in memory on purpose: the graph algorithms are the
 * product and the Phase-7 agent reuses them. SQL-side aggregation is the
 * documented scale seam; `truncated` keeps oversized windows honest.
 */
@Injectable()
export class TopologyService {
  constructor(
    @Inject(TRACE_READER) private readonly reader: TraceReader,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  async topology(tenantId: TenantId, query: WindowQuery): Promise<TopologyGraph> {
    const window = resolveWindow(query, {
      lookbackMs: this.config.defaultLookbackHours * 3_600_000,
      maxWindowMs: this.config.maxWindowDays * 86_400_000,
    });
    const rows = await this.reader.getSpansForTopology(tenantId, {
      ...window,
      maxRows: this.config.topologyMaxRows,
    });
    const truncated = rows.length > this.config.topologyMaxRows;
    const spans = rows.slice(0, this.config.topologyMaxRows).map(toTopologySpan);
    return buildTopology(spans, { truncated });
  }
}
