import type { TenantId } from '@ariadne/protocol';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import type { StorageDb } from './db';
import { alertEvents, alertRules } from './schema/alerts';

export type StoredAlertRule = InferSelectModel<typeof alertRules>;
export type StoredAlertEvent = InferSelectModel<typeof alertEvents>;

export interface NewAlertRule {
  readonly ruleId: string;
  readonly name: string;
  readonly kind: string;
  readonly config: Record<string, string | number>;
  readonly webhookUrl: string | null;
}

export interface NewAlertEvent {
  readonly eventId: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly kind: string;
  readonly message: string;
  readonly context: Record<string, string | number>;
}

/**
 * API-owned alerting tables (same write posture as insights). Rule CRUD is
 * tenant-scoped; `listAllEnabledRules` is the one cross-tenant read and
 * exists solely for the evaluator loop — it is never reachable from HTTP.
 */
export class AlertStore {
  constructor(private readonly db: StorageDb) {}

  async insertRule(tenantId: TenantId, rule: NewAlertRule): Promise<StoredAlertRule> {
    const rows = await this.db
      .insert(alertRules)
      .values({ tenantId, ...rule })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error('alert rule id collision');
    return row;
  }

  async listRules(tenantId: TenantId): Promise<StoredAlertRule[]> {
    return this.db
      .select()
      .from(alertRules)
      .where(eq(alertRules.tenantId, tenantId))
      .orderBy(desc(alertRules.createdAt));
  }

  /** Evaluator-only: every enabled rule across all tenants. */
  async listAllEnabledRules(): Promise<StoredAlertRule[]> {
    return this.db.select().from(alertRules).where(eq(alertRules.enabled, true));
  }

  async setRuleEnabled(tenantId: TenantId, ruleId: string, enabled: boolean): Promise<boolean> {
    const rows = await this.db
      .update(alertRules)
      .set({ enabled, updatedAt: sql`now()` })
      .where(and(eq(alertRules.tenantId, tenantId), eq(alertRules.ruleId, ruleId)))
      .returning({ ruleId: alertRules.ruleId });
    return rows.length > 0;
  }

  /** Edge-trigger bookkeeping: returns true only when the state actually changed. */
  async setRuleState(tenantId: TenantId, ruleId: string, state: 'ok' | 'breach'): Promise<boolean> {
    const rows = await this.db
      .update(alertRules)
      .set({ lastState: state, updatedAt: sql`now()` })
      .where(
        and(
          eq(alertRules.tenantId, tenantId),
          eq(alertRules.ruleId, ruleId),
          sql`${alertRules.lastState} <> ${state}`
        )
      )
      .returning({ ruleId: alertRules.ruleId });
    return rows.length > 0;
  }

  async deleteRule(tenantId: TenantId, ruleId: string): Promise<boolean> {
    const rows = await this.db
      .delete(alertRules)
      .where(and(eq(alertRules.tenantId, tenantId), eq(alertRules.ruleId, ruleId)))
      .returning({ ruleId: alertRules.ruleId });
    return rows.length > 0;
  }

  async insertEvent(tenantId: TenantId, event: NewAlertEvent): Promise<StoredAlertEvent> {
    const rows = await this.db
      .insert(alertEvents)
      .values({ tenantId, ...event })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error('alert event id collision');
    return row;
  }

  async listEvents(tenantId: TenantId, limit: number): Promise<StoredAlertEvent[]> {
    return this.db
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.tenantId, tenantId))
      .orderBy(desc(alertEvents.firedAt), desc(alertEvents.eventId))
      .limit(limit);
  }

  async acknowledgeEvent(tenantId: TenantId, eventId: string): Promise<boolean> {
    const rows = await this.db
      .update(alertEvents)
      .set({ acknowledged: true })
      .where(and(eq(alertEvents.tenantId, tenantId), eq(alertEvents.eventId, eventId)))
      .returning({ eventId: alertEvents.eventId });
    return rows.length > 0;
  }
}
