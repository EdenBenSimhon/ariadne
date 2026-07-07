import { randomUUID } from 'node:crypto';
import { traceIdSchema, type TenantId } from '@ariadne/protocol';
import type { Insight, InsightsResponse } from '@ariadne/graph';
import type { InsightStore, StoredInsight } from '@ariadne/storage';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { INSIGHT_STORE } from '../storage/storage.module';

/**
 * Insight text is written by the agent from LLM output, so it is treated as
 * untrusted on the way IN as well: control characters are blanked and length
 * is capped before storage, mirroring the MCP distillation posture (B4).
 */
function sanitizeText(text: string, maxChars: number): string {
  let out = '';
  for (const char of text.slice(0, maxChars)) {
    const code = char.codePointAt(0) ?? 32;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out.trim();
}

export const createInsightSchema = z.object({
  kind: z.enum(['flow-change', 'error-pattern', 'anomaly', 'observation']),
  title: z.string().min(1).max(256),
  body: z.string().min(1).max(4000),
  traceIds: z.array(traceIdSchema).max(20).default([]),
  createdBy: z.enum(['agent', 'user']).default('agent'),
});

export type CreateInsight = z.infer<typeof createInsightSchema>;

function toInsight(row: StoredInsight): Insight {
  return {
    insightId: row.insightId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    traceIds: row.traceIds,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class InsightsService {
  constructor(@Inject(INSIGHT_STORE) private readonly store: InsightStore) {}

  async create(tenantId: TenantId, input: CreateInsight): Promise<Insight> {
    const title = sanitizeText(input.title, 256);
    const body = sanitizeText(input.body, 4000);
    if (title.length === 0 || body.length === 0) {
      throw new BadRequestException('insight title/body empty after sanitization');
    }
    const row = await this.store.insert(tenantId, {
      insightId: randomUUID(),
      kind: input.kind,
      title,
      body,
      traceIds: input.traceIds,
      createdBy: input.createdBy,
    });
    return toInsight(row);
  }

  async list(tenantId: TenantId, limit: number): Promise<InsightsResponse> {
    const rows = await this.store.list(tenantId, limit);
    return { items: rows.map(toInsight) };
  }

  async delete(tenantId: TenantId, insightId: string): Promise<void> {
    const idResult = z.string().uuid().safeParse(insightId);
    if (!idResult.success) throw new BadRequestException('malformed insight id');
    const deleted = await this.store.delete(tenantId, idResult.data);
    if (!deleted) throw new NotFoundException('insight not found');
  }
}
