import { traceIdSchema, type TenantId } from '@ariadne/protocol';
import {
  buildTraceDag,
  computeCriticalPath,
  type GraphSpan,
  type Paginated,
  type TraceDetail,
  type TraceSummary,
} from '@ariadne/graph';
import type { StoredSpan, StoredTrace, TraceListFilter, TraceReader } from '@ariadne/storage';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { decodeCursor, encodeCursor } from '../common/query';
import { TRACE_READER } from '../storage/storage.module';
import type { TracesQuery } from './traces-query';

export function toTraceSummary(row: StoredTrace): TraceSummary {
  return {
    traceId: row.traceId,
    rootService: row.rootService,
    spanCount: row.spanCount,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    durationMs: row.durationMs ?? Math.max(0, row.endTime.getTime() - row.startTime.getTime()),
    hasError: row.hasError,
  };
}

export function storedSpanToGraphSpan(row: StoredSpan): GraphSpan {
  return {
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

@Injectable()
export class TracesService {
  constructor(@Inject(TRACE_READER) private readonly reader: TraceReader) {}

  async list(tenantId: TenantId, query: TracesQuery): Promise<Paginated<TraceSummary>> {
    const filter: TraceListFilter = {
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: decodeCursor(query.cursor) } : {}),
      ...(query.service !== undefined ? { rootService: query.service } : {}),
      ...(query.status !== undefined ? { hasError: query.status === 'error' } : {}),
      ...(query.from !== undefined ? { from: new Date(query.from) } : {}),
      ...(query.to !== undefined ? { to: new Date(query.to) } : {}),
    };
    const rows = await this.reader.listTraces(tenantId, filter);
    const pageRows = rows.slice(0, query.limit);
    const lastRow = pageRows[pageRows.length - 1];
    return {
      items: pageRows.map(toTraceSummary),
      nextCursor:
        rows.length > query.limit && lastRow !== undefined
          ? encodeCursor(lastRow.startTime, lastRow.traceId)
          : null,
    };
  }

  async detail(tenantId: TenantId, rawTraceId: string): Promise<TraceDetail> {
    // Malformed ids never reach the database.
    const parsed = traceIdSchema.safeParse(rawTraceId);
    if (!parsed.success) throw new BadRequestException('malformed trace id');
    const traceId = parsed.data;

    const trace = await this.reader.getTrace(tenantId, traceId);
    if (trace === null) throw new NotFoundException('trace not found');

    const spans = (await this.reader.getSpansForTrace(tenantId, traceId)).map(
      storedSpanToGraphSpan
    );
    const dag = buildTraceDag(traceId, spans);
    return {
      trace: toTraceSummary(trace),
      spans,
      dag,
      criticalPath: computeCriticalPath(dag),
    };
  }
}
