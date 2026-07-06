import type {
  SpanId,
  SpanKind,
  SpanStatus,
  TenantId,
  TraceId,
  TransportKind,
} from '@ariadne/protocol';
import { and, asc, desc, eq, gte, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { StorageDb } from './db';
import { spans } from './schema/spans';
import { traces } from './schema/traces';
import type { StoredSpan } from './span-row';
import type { StoredTrace } from './trace-row';

export interface TraceListFilter {
  readonly limit: number;
  /** Keyset cursor — strictly older than this (start_time, trace_id) pair. */
  readonly cursor?: { readonly startTime: Date; readonly traceId: TraceId };
  readonly rootService?: string;
  readonly hasError?: boolean;
  readonly from?: Date;
  readonly to?: Date;
}

export interface TimeWindow {
  readonly from: Date;
  readonly to: Date;
}

/** Narrow projection for topology — deliberately excludes metadata/payload-ish columns. */
export interface TopologySpanRow {
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly parentSpanId: SpanId | null;
  readonly serviceName: string;
  readonly spanKind: SpanKind;
  readonly transport: TransportKind;
  readonly channel: string;
  readonly operationName: string;
  readonly startTime: Date;
  readonly durationMs: number;
  readonly status: SpanStatus;
  readonly error: string | null;
}

export interface StatsRow {
  readonly traceCount: number;
  readonly errorTraceCount: number;
  readonly avgDurationMs: number | null;
  readonly p50DurationMs: number | null;
  readonly p95DurationMs: number | null;
  readonly spanCount: number;
  readonly serviceCount: number;
}

const toNullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * Read side of the two-table model (spec §8), used by the API (and later the
 * agent) through the SELECT-only `eventtracer_reader` role. Every query takes
 * tenantId first and puts it first in the WHERE — tenant isolation is
 * structural, not per-endpoint (security B3).
 */
export class TraceReader {
  constructor(
    private readonly db: StorageDb,
    private readonly pool: Pool
  ) {}

  /**
   * Newest-first keyset pagination over the pre-computed traces table (no
   * GROUP BY). Returns up to limit+1 rows so the caller can derive nextCursor.
   */
  async listTraces(tenantId: TenantId, filter: TraceListFilter): Promise<StoredTrace[]> {
    const conditions: SQL[] = [eq(traces.tenantId, tenantId)];
    if (filter.rootService !== undefined) {
      conditions.push(eq(traces.rootService, filter.rootService));
    }
    if (filter.hasError !== undefined) conditions.push(eq(traces.hasError, filter.hasError));
    if (filter.from !== undefined) conditions.push(gte(traces.startTime, filter.from));
    if (filter.to !== undefined) conditions.push(lte(traces.startTime, filter.to));
    if (filter.cursor !== undefined) {
      const cursorPredicate = or(
        lt(traces.startTime, filter.cursor.startTime),
        and(
          eq(traces.startTime, filter.cursor.startTime),
          lt(traces.traceId, filter.cursor.traceId)
        )
      );
      if (cursorPredicate !== undefined) conditions.push(cursorPredicate);
    }
    return this.db
      .select()
      .from(traces)
      .where(and(...conditions))
      .orderBy(desc(traces.startTime), desc(traces.traceId))
      .limit(filter.limit + 1);
  }

  async getTrace(tenantId: TenantId, traceId: TraceId): Promise<StoredTrace | null> {
    const rows = await this.db
      .select()
      .from(traces)
      .where(and(eq(traces.tenantId, tenantId), eq(traces.traceId, traceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getSpansForTrace(tenantId: TenantId, traceId: TraceId): Promise<StoredSpan[]> {
    return this.db
      .select()
      .from(spans)
      .where(and(eq(spans.tenantId, tenantId), eq(spans.traceId, traceId)))
      .orderBy(asc(spans.startTime));
  }

  /** Window is partition-pruned via start_time; fetches maxRows+1 so the caller sets `truncated`. */
  async getSpansForTopology(
    tenantId: TenantId,
    window: TimeWindow & { readonly maxRows: number }
  ): Promise<TopologySpanRow[]> {
    return this.db
      .select({
        traceId: spans.traceId,
        spanId: spans.spanId,
        parentSpanId: spans.parentSpanId,
        serviceName: spans.serviceName,
        spanKind: spans.spanKind,
        transport: spans.transport,
        channel: spans.channel,
        operationName: spans.operationName,
        startTime: spans.startTime,
        durationMs: spans.durationMs,
        status: spans.status,
        error: spans.error,
      })
      .from(spans)
      .where(
        and(
          eq(spans.tenantId, tenantId),
          gte(spans.startTime, window.from),
          lte(spans.startTime, window.to)
        )
      )
      .limit(window.maxRows + 1);
  }

  async getStats(tenantId: TenantId, window: TimeWindow): Promise<StatsRow> {
    const traceRows = await this.db
      .select({
        traceCount: sql<number>`count(*)`.mapWith(Number),
        errorTraceCount: sql<number>`count(*) filter (where ${traces.hasError})`.mapWith(Number),
        avgDurationMs: sql<number | null>`avg(${traces.durationMs})`.mapWith(toNullableNumber),
        p50DurationMs: sql<number | null>`percentile_cont(0.5) within group (order by ${traces.durationMs})`.mapWith(toNullableNumber),
        p95DurationMs: sql<number | null>`percentile_cont(0.95) within group (order by ${traces.durationMs})`.mapWith(toNullableNumber),
      })
      .from(traces)
      .where(
        and(
          eq(traces.tenantId, tenantId),
          gte(traces.startTime, window.from),
          lte(traces.startTime, window.to)
        )
      );
    const spanRows = await this.db
      .select({
        spanCount: sql<number>`count(*)`.mapWith(Number),
        serviceCount: sql<number>`count(distinct ${spans.serviceName})`.mapWith(Number),
      })
      .from(spans)
      .where(
        and(
          eq(spans.tenantId, tenantId),
          gte(spans.startTime, window.from),
          lte(spans.startTime, window.to)
        )
      );
    const traceStats = traceRows[0];
    const spanStats = spanRows[0];
    return {
      traceCount: traceStats?.traceCount ?? 0,
      errorTraceCount: traceStats?.errorTraceCount ?? 0,
      avgDurationMs: traceStats?.avgDurationMs ?? null,
      p50DurationMs: traceStats?.p50DurationMs ?? null,
      p95DurationMs: traceStats?.p95DurationMs ?? null,
      spanCount: spanStats?.spanCount ?? 0,
      serviceCount: spanStats?.serviceCount ?? 0,
    };
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`SELECT 1`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
