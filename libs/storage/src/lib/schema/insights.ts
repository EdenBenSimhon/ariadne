import type { TenantId } from '@ariadne/protocol';
import { index, jsonb, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Agent/user conclusions ABOUT trace data (spec §9 seam). This is the only
 * writable surface the API owns: spans and traces stay immutable and
 * collector-owned. An insight is a distilled, size-capped text conclusion
 * ("checkout flow lost its payment hop after 14:00") plus the trace ids that
 * evidence it — never raw span payloads.
 */
export const insights = pgTable(
  'insights',
  {
    tenantId: varchar('tenant_id', { length: 64 }).$type<TenantId>().notNull(),
    insightId: varchar('insight_id', { length: 36 }).notNull(),
    /** Coarse classification: flow-change | error-pattern | anomaly | observation. */
    kind: varchar('kind', { length: 32 }).notNull(),
    title: varchar('title', { length: 256 }).notNull(),
    body: varchar('body', { length: 4000 }).notNull(),
    /** Evidence pointers — trace ids only, validated + capped at the API. */
    traceIds: jsonb('trace_ids').$type<readonly string[]>().notNull(),
    /** Who concluded it: 'agent' | 'user'. */
    createdBy: varchar('created_by', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'insights_pk', columns: [t.tenantId, t.insightId] }),
    index('insights_time_idx').on(t.tenantId, t.createdAt),
  ]
);
