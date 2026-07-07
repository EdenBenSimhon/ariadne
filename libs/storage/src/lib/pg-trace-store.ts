import type { SpanEvent } from '@ariadne/protocol';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { StorageDb } from './db';
import { spans } from './schema/spans';
import { traces } from './schema/traces';
import { spanEventToRow } from './span-row';
import { computeTraceAggregates } from './trace-aggregate';
import type { InsertResult, TraceStore } from './trace-store';

/**
 * Postgres TraceStore (spec §8). One transaction per batch:
 *
 * 1. Multi-row `INSERT ... ON CONFLICT (tenant_id, span_id, start_time)
 *    DO NOTHING ... RETURNING` — a span is immutable, so first-write-wins is
 *    the replay defense (B2): a replayed or forged duplicate can never
 *    overwrite stored history.
 * 2. RETURNING yields ONLY actually-inserted rows; the traces aggregate delta
 *    is computed from those, which keeps span_count exact under at-least-once
 *    redelivery.
 * 3. A commutative `ON CONFLICT DO UPDATE` merges the delta into traces —
 *    correct for out-of-order arrival (root may come last: COALESCE fills
 *    root_service whenever it appears).
 *
 * Rows and aggregates are sorted before writing so concurrent collector
 * replicas take row locks in the same order (no deadlocks).
 */
export class PgTraceStore implements TraceStore {
  constructor(
    private readonly db: StorageDb,
    private readonly pool: Pool
  ) {}

  async insertSpans(events: readonly SpanEvent[]): Promise<InsertResult> {
    if (events.length === 0) return { received: 0, inserted: 0, duplicates: 0 };
    const rows = events
      .map(spanEventToRow)
      .sort(
        (a, b) => a.tenantId.localeCompare(b.tenantId) || a.spanId.localeCompare(b.spanId)
      );

    return this.db.transaction(async (tx) => {
      const insertedRows = await tx
        .insert(spans)
        .values(rows)
        .onConflictDoNothing({ target: [spans.tenantId, spans.spanId, spans.startTime] })
        .returning({
          tenantId: spans.tenantId,
          traceId: spans.traceId,
          parentSpanId: spans.parentSpanId,
          serviceName: spans.serviceName,
          startTime: spans.startTime,
          durationMs: spans.durationMs,
          status: spans.status,
        });

      const aggregates = computeTraceAggregates(insertedRows);
      if (aggregates.length > 0) {
        await tx
          .insert(traces)
          .values(
            aggregates.map((a) => ({
              tenantId: a.tenantId,
              traceId: a.traceId,
              rootService: a.rootService,
              spanCount: a.spanCount,
              startTime: a.startTime,
              endTime: a.endTime,
              hasError: a.hasError,
            }))
          )
          .onConflictDoUpdate({
            target: [traces.tenantId, traces.traceId],
            set: {
              rootService: sql`COALESCE(${traces.rootService}, excluded.root_service)`,
              spanCount: sql`${traces.spanCount} + excluded.span_count`,
              startTime: sql`LEAST(${traces.startTime}, excluded.start_time)`,
              endTime: sql`GREATEST(${traces.endTime}, excluded.end_time)`,
              hasError: sql`${traces.hasError} OR excluded.has_error`,
              updatedAt: sql`now()`,
            },
          });
      }

      return {
        received: events.length,
        inserted: insertedRows.length,
        duplicates: events.length - insertedRows.length,
      };
    });
  }

  async runRetention(keepDays: number): Promise<number> {
    const result = await this.pool.query<{ eventtracer_retention: number }>(
      'SELECT eventtracer_retention($1)',
      [Math.floor(keepDays)]
    );
    return Number(result.rows[0]?.eventtracer_retention ?? 0);
  }

  async ping(): Promise<void> {
    await this.db.execute(sql`SELECT 1`);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
