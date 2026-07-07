import type { TenantId } from '@ariadne/protocol';
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { parseQuery } from '../common/query';
import { Tenant } from '../tenant/tenant';
import { AlertsService, createAlertRuleSchema } from './alerts.service';

const enabledSchema = z.object({ enabled: z.boolean() });

@Controller('alerts')
export class AlertsController {
  private readonly listSchema;

  constructor(
    private readonly alerts: AlertsService,
    @Inject(API_CONFIG) config: ApiConfig
  ) {
    this.listSchema = z.object({
      limit: z.coerce.number().int().min(1).max(config.maxPageSize).default(50),
    });
  }

  @Post('rules')
  createRule(@Tenant() tenantId: TenantId, @Body() raw: unknown) {
    return this.alerts.createRule(tenantId, parseQuery(createAlertRuleSchema, raw));
  }

  @Get('rules')
  listRules(@Tenant() tenantId: TenantId) {
    return this.alerts.listRules(tenantId);
  }

  @Patch('rules/:id')
  async toggleRule(@Tenant() tenantId: TenantId, @Param('id') id: string, @Body() raw: unknown) {
    await this.alerts.setRuleEnabled(tenantId, id, parseQuery(enabledSchema, raw).enabled);
    return { updated: true };
  }

  @Delete('rules/:id')
  async deleteRule(@Tenant() tenantId: TenantId, @Param('id') id: string) {
    await this.alerts.deleteRule(tenantId, id);
    return { deleted: true };
  }

  @Get('events')
  listEvents(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.alerts.listEvents(tenantId, parseQuery(this.listSchema, raw).limit);
  }

  @Post('events/:id/ack')
  async ack(@Tenant() tenantId: TenantId, @Param('id') id: string) {
    await this.alerts.acknowledgeEvent(tenantId, id);
    return { acknowledged: true };
  }
}
