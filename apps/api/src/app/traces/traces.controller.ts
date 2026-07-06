import type { TenantId } from '@ariadne/protocol';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { parseQuery } from '../common/query';
import { Tenant } from '../tenant/tenant';
import { makeTracesQuerySchema } from './traces-query';
import { TracesService } from './traces.service';

@Controller('traces')
export class TracesController {
  private readonly querySchema;

  constructor(
    private readonly traces: TracesService,
    @Inject(API_CONFIG) config: ApiConfig
  ) {
    this.querySchema = makeTracesQuerySchema(config.maxPageSize, config.defaultPageSize);
  }

  @Get()
  list(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.traces.list(tenantId, parseQuery(this.querySchema, raw));
  }

  @Get(':id')
  detail(@Tenant() tenantId: TenantId, @Param('id') id: string) {
    return this.traces.detail(tenantId, id);
  }
}
