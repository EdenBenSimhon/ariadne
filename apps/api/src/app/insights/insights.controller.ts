import type { TenantId } from '@ariadne/protocol';
import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { parseQuery } from '../common/query';
import { Tenant } from '../tenant/tenant';
import { createInsightSchema, InsightsService } from './insights.service';

@Controller('insights')
export class InsightsController {
  private readonly listSchema;

  constructor(
    private readonly insights: InsightsService,
    @Inject(API_CONFIG) config: ApiConfig
  ) {
    this.listSchema = z.object({
      limit: z.coerce.number().int().min(1).max(config.maxPageSize).default(50),
    });
  }

  @Post()
  create(@Tenant() tenantId: TenantId, @Body() raw: unknown) {
    return this.insights.create(tenantId, parseQuery(createInsightSchema, raw));
  }

  @Get()
  list(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.insights.list(tenantId, parseQuery(this.listSchema, raw).limit);
  }

  @Delete(':id')
  async remove(@Tenant() tenantId: TenantId, @Param('id') id: string) {
    await this.insights.delete(tenantId, id);
    return { deleted: true };
  }
}
