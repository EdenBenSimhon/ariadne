import type { TenantId } from '@ariadne/protocol';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Alerting (the "tell me before a customer does" layer). Rules are evaluated
 * by the API on an interval; a breach inserts an alert_event exactly once per
 * incident — `last_state` on the rule flips to 'breach' and must recover to
 * 'ok' before the same rule can fire again. Both tables are API-owned and
 * writable by the reader role (like insights); trace data stays immutable.
 */
export const alertRules = pgTable(
  'alert_rules',
  {
    tenantId: varchar('tenant_id', { length: 64 }).$type<TenantId>().notNull(),
    ruleId: varchar('rule_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    /** error-rate | latency-p95 | flow-missing | flow-drift | service-silent */
    kind: varchar('kind', { length: 32 }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Kind-specific settings: threshold, windowMinutes, service, signature. */
    config: jsonb('config').$type<Record<string, string | number>>().notNull(),
    /** Optional notification target; validated https URL. */
    webhookUrl: varchar('webhook_url', { length: 512 }),
    /** 'ok' | 'breach' — edge-triggered firing, not level-triggered spam. */
    lastState: varchar('last_state', { length: 8 }).notNull().default('ok'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'alert_rules_pk', columns: [t.tenantId, t.ruleId] })]
);

export const alertEvents = pgTable(
  'alert_events',
  {
    tenantId: varchar('tenant_id', { length: 64 }).$type<TenantId>().notNull(),
    eventId: varchar('event_id', { length: 36 }).notNull(),
    ruleId: varchar('rule_id', { length: 36 }).notNull(),
    ruleName: varchar('rule_name', { length: 128 }).notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    message: varchar('message', { length: 1024 }).notNull(),
    /** Small structured evidence (observed value, threshold, window). */
    context: jsonb('context').$type<Record<string, string | number>>().notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    acknowledged: boolean('acknowledged').notNull().default(false),
  },
  (t) => [
    primaryKey({ name: 'alert_events_pk', columns: [t.tenantId, t.eventId] }),
    index('alert_events_time_idx').on(t.tenantId, t.firedAt),
  ]
);
