import type { TenantId } from '@ariadne/protocol';
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { parseQuery, windowQuerySchema } from '../common/query';
import { Tenant } from '../tenant/tenant';
import { StatsService } from './stats.service';

const timeseriesQuerySchema = windowQuerySchema.extend({
  bucketMinutes: z.coerce.number().int().min(1).max(1_440).default(30),
});

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  get(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.stats.stats(tenantId, parseQuery(windowQuerySchema, raw));
  }

  /** Bucketed counts / error counts / p95 — dashboard sparklines. */
  @Get('timeseries')
  timeseries(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.stats.timeseries(tenantId, parseQuery(timeseriesQuerySchema, raw));
  }
}
