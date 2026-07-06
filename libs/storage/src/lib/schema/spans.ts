import type {
  Metadata,
  SpanId,
  SpanKind,
  SpanStatus,
  TenantId,
  TraceId,
  TransportKind,
} from '@ariadne/protocol';
import {
  char,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Raw spans (spec §8). Source of truth for TYPES AND QUERIES ONLY — the DDL
 * lives in the hand-written migration 0001 because this table is natively
 * range-partitioned by start_time (daily), which drizzle-kit cannot express.
 * Keep this file and that migration in sync.
 *
 * The PK includes start_time because Postgres requires the partition key in
 * every unique constraint. True replays are byte-identical (same start_time)
 * so dedupe by (tenant_id, span_id) still holds; a forged same-spanId,
 * different-time message lands as a separate row — accepted caveat.
 *
 * Column generics carry the protocol's branded types: every row was validated
 * by parseSpanEvent at the ingestion boundary, so the DB is inside the trust
 * boundary and reads may keep the brands.
 */
export const spans = pgTable(
  'spans',
  {
    tenantId: varchar('tenant_id', { length: 64 }).$type<TenantId>().notNull(),
    spanId: char('span_id', { length: 16 }).$type<SpanId>().notNull(),
    traceId: char('trace_id', { length: 32 }).$type<TraceId>().notNull(),
    parentSpanId: char('parent_span_id', { length: 16 }).$type<SpanId>(),
    serviceName: varchar('service_name', { length: 128 }).notNull(),
    spanKind: varchar('span_kind', { length: 8 }).$type<SpanKind>().notNull(),
    transport: varchar('transport', { length: 16 }).$type<TransportKind>().notNull(),
    channel: varchar('channel', { length: 256 }).notNull(),
    operationName: varchar('operation_name', { length: 256 }).notNull(),
    startTime: timestamp('start_time', { withTimezone: true, mode: 'date' }).notNull(),
    durationMs: integer('duration_ms').notNull(),
    status: varchar('status', { length: 8 }).$type<SpanStatus>().notNull(),
    error: varchar('error', { length: 1024 }),
    metadata: jsonb('metadata').$type<Metadata>(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'spans_pk', columns: [t.tenantId, t.spanId, t.startTime] }),
    index('spans_trace_idx').on(t.tenantId, t.traceId),
    index('spans_service_time_idx').on(t.tenantId, t.serviceName, t.startTime),
    index('spans_time_idx').on(t.tenantId, t.startTime),
  ]
);
