import { traceIdSchema, type TenantId } from '@ariadne/protocol';
import type { Paginated, ServiceSummary, SpanLogEntry } from '@ariadne/graph';
import type { SpanSearchFilter, StoredSpan, TraceReader } from '@ariadne/storage';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import {
  decodeSpanCursor,
  encodeSpanCursor,
  resolveWindow,
  type WindowQuery,
} from '../common/query';
import { TRACE_READER } from '../storage/storage.module';
import type { SpansQuery } from './spans-query';

export function toSpanLogEntry(row: StoredSpan): SpanLogEntry {
  return {
    traceId: row.traceId,
    spanId: row.spanId,
    serviceName: row.serviceName,
    spanKind: row.spanKind,
    transport: row.transport,
    channel: row.channel,
    operationName: row.operationName,
    startTime: row.startTime.toISOString(),
    durationMs: row.durationMs,
    status: row.status,
    error: row.error,
    metadata: row.metadata,
  };
}

/** The logger-style read model: raw spans as searchable, filterable log lines. */
@Injectable()
export class SpansService {
  constructor(
    @Inject(TRACE_READER) private readonly reader: TraceReader,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  private window(query: WindowQuery) {
    return resolveWindow(query, {
      lookbackMs: this.config.defaultLookbackHours * 3_600_000,
      maxWindowMs: this.config.maxWindowDays * 86_400_000,
    });
  }

  async search(tenantId: TenantId, query: SpansQuery): Promise<Paginated<SpanLogEntry>> {
    const window = this.window(query);
    const filter: SpanSearchFilter = {
      limit: query.limit,
      from: window.from,
      to: window.to,
      ...(query.cursor !== undefined ? { cursor: decodeSpanCursor(query.cursor) } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.service !== undefined ? { service: query.service } : {}),
      ...(query.channel !== undefined ? { channel: query.channel } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.transport !== undefined ? { transport: query.transport } : {}),
      ...(query.spanKind !== undefined ? { spanKind: query.spanKind } : {}),
      ...(query.minDurationMs !== undefined ? { minDurationMs: query.minDurationMs } : {}),
      ...(query.metaKey !== undefined ? { metaKey: query.metaKey } : {}),
      ...(query.metaValue !== undefined ? { metaValue: query.metaValue } : {}),
    };
    const rows = await this.reader.searchSpans(tenantId, filter);
    const pageRows = rows.slice(0, query.limit);
    const lastRow = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map(toSpanLogEntry),
      nextCursor:
        rows.length > query.limit && lastRow !== undefined
          ? encodeSpanCursor(lastRow.startTime, lastRow.spanId)
          : null,
    };
  }

  /** All spans of one trace as log entries — includes redacted metadata (unlike TraceDetail). */
  async traceSpans(tenantId: TenantId, rawTraceId: string): Promise<{ items: SpanLogEntry[] }> {
    const parsed = traceIdSchema.safeParse(rawTraceId);
    if (!parsed.success) throw new BadRequestException('malformed trace id');
    const rows = await this.reader.getSpansForTrace(tenantId, parsed.data);
    return { items: rows.map(toSpanLogEntry) };
  }

  async services(tenantId: TenantId, query: WindowQuery): Promise<readonly ServiceSummary[]> {
    const window = this.window(query);
    const rows = await this.reader.listServiceSummaries(tenantId, window);
    return rows.map((row) => ({
      ...row,
      errorRate: row.spanCount > 0 ? row.errorCount / row.spanCount : 0,
    }));
  }
}
