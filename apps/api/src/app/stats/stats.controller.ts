import type { TenantId } from '@ariadne/protocol';
import { Controller, Get, Query } from '@nestjs/common';
import { parseQuery, windowQuerySchema } from '../common/query';
import { Tenant } from '../tenant/tenant';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  get(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.stats.stats(tenantId, parseQuery(windowQuerySchema, raw));
  }
}
