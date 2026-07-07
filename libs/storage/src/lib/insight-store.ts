import type { TenantId } from '@ariadne/protocol';
import { and, desc, eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { StorageDb } from './db';
import { insights } from './schema/insights';

export type InsightRow = InferInsertModel<typeof insights>;
export type StoredInsight = InferSelectModel<typeof insights>;

export interface NewInsight {
  readonly insightId: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly traceIds: readonly string[];
  readonly createdBy: string;
}

/**
 * The API's only write path (agent conclusions + user annotations). Kept
 * separate from TraceReader so the read side of trace data stays visibly
 * read-only; trace/span tables remain collector-owned and immutable (B2).
 */
export class InsightStore {
  constructor(private readonly db: StorageDb) {}

  async insert(tenantId: TenantId, insight: NewInsight): Promise<StoredInsight> {
    const rows = await this.db
      .insert(insights)
      .values({ tenantId, ...insight })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error('insight id collision');
    return row;
  }

  async list(tenantId: TenantId, limit: number): Promise<StoredInsight[]> {
    return this.db
      .select()
      .from(insights)
      .where(eq(insights.tenantId, tenantId))
      .orderBy(desc(insights.createdAt), desc(insights.insightId))
      .limit(limit);
  }

  /** Returns true when a row was actually deleted for this tenant. */
  async delete(tenantId: TenantId, insightId: string): Promise<boolean> {
    const rows = await this.db
      .delete(insights)
      .where(and(eq(insights.tenantId, tenantId), eq(insights.insightId, insightId)))
      .returning({ insightId: insights.insightId });
    return rows.length > 0;
  }
}
