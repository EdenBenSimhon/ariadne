import type { TenantId, TraceId } from '@ariadne/protocol';
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Pre-computed per-trace aggregate (spec §8) — trace listing never GROUPs BY
 * over spans. Maintained by the collector with a commutative upsert, so spans
 * may arrive in any order and any number of times:
 * root_service is null until the root span (parentSpanId null) shows up.
 *
 * Not partitioned: ~1 row per trace; the TTL job deletes via traces_time_idx.
 * This file IS diffed by drizzle-kit (migration 0000).
 */
export const traces = pgTable(
  'traces',
  {
    tenantId: varchar('tenant_id', { length: 64 }).$type<TenantId>().notNull(),
    traceId: char('trace_id', { length: 32 }).$type<TraceId>().notNull(),
    rootService: varchar('root_service', { length: 128 }),
    spanCount: integer('span_count').notNull(),
    startTime: timestamp('start_time', { withTimezone: true, mode: 'date' }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true, mode: 'date' }).notNull(),
    durationMs: integer('duration_ms').generatedAlwaysAs(
      sql`(EXTRACT(EPOCH FROM (end_time - start_time)) * 1000)::int`
    ),
    hasError: boolean('has_error').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'traces_pk', columns: [t.tenantId, t.traceId] }),
    index('traces_time_idx').on(t.tenantId, t.startTime),
  ]
);
