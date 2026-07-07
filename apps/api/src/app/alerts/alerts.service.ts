import { randomUUID } from 'node:crypto';
import type { TenantId } from '@ariadne/protocol';
import type { AlertEvent, AlertRule, AlertRuleKind } from '@ariadne/graph';
import type { AlertStore, StoredAlertEvent, StoredAlertRule } from '@ariadne/storage';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { ALERT_STORE } from '../storage/storage.module';
import { alertRuleKinds, ruleConfigSchemas } from './evaluate';

export const createAlertRuleSchema = z.object({
  name: z.string().min(1).max(128),
  kind: z.enum(alertRuleKinds as [AlertRuleKind, ...AlertRuleKind[]]),
  config: z.record(z.string(), z.union([z.string(), z.number()])),
  /** https only in spirit; http allowed for local webhook receivers. */
  webhookUrl: z.string().url().max(512).regex(/^https?:\/\//).optional(),
});

export type CreateAlertRule = z.infer<typeof createAlertRuleSchema>;

function toRule(row: StoredAlertRule): AlertRule {
  return {
    ruleId: row.ruleId,
    name: row.name,
    kind: row.kind as AlertRuleKind,
    enabled: row.enabled,
    config: row.config,
    webhookUrl: row.webhookUrl,
    lastState: row.lastState === 'breach' ? 'breach' : 'ok',
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAlertEvent(row: StoredAlertEvent): AlertEvent {
  return {
    eventId: row.eventId,
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    kind: row.kind,
    message: row.message,
    context: row.context,
    firedAt: row.firedAt.toISOString(),
    acknowledged: row.acknowledged,
  };
}

@Injectable()
export class AlertsService {
  constructor(@Inject(ALERT_STORE) private readonly store: AlertStore) {}

  async createRule(tenantId: TenantId, input: CreateAlertRule): Promise<AlertRule> {
    // The kind's own schema validates + defaults the config payload.
    const parsed = ruleConfigSchemas[input.kind].safeParse(input.config);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: `invalid config for kind ${input.kind}`,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const row = await this.store.insertRule(tenantId, {
      ruleId: randomUUID(),
      name: input.name,
      kind: input.kind,
      config: parsed.data as Record<string, string | number>,
      webhookUrl: input.webhookUrl ?? null,
    });
    return toRule(row);
  }

  async listRules(tenantId: TenantId): Promise<{ items: AlertRule[] }> {
    return { items: (await this.store.listRules(tenantId)).map(toRule) };
  }

  async setRuleEnabled(tenantId: TenantId, ruleId: string, enabled: boolean): Promise<void> {
    if (!(await this.store.setRuleEnabled(tenantId, this.validId(ruleId), enabled))) {
      throw new NotFoundException('alert rule not found');
    }
  }

  async deleteRule(tenantId: TenantId, ruleId: string): Promise<void> {
    if (!(await this.store.deleteRule(tenantId, this.validId(ruleId)))) {
      throw new NotFoundException('alert rule not found');
    }
  }

  async listEvents(tenantId: TenantId, limit: number): Promise<{ items: AlertEvent[] }> {
    return { items: (await this.store.listEvents(tenantId, limit)).map(toAlertEvent) };
  }

  async acknowledgeEvent(tenantId: TenantId, eventId: string): Promise<void> {
    if (!(await this.store.acknowledgeEvent(tenantId, this.validId(eventId)))) {
      throw new NotFoundException('alert event not found');
    }
  }

  private validId(raw: string): string {
    const parsed = z.string().uuid().safeParse(raw);
    if (!parsed.success) throw new BadRequestException('malformed id');
    return parsed.data;
  }
}
