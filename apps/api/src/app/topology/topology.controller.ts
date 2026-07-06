import type { TenantId } from '@ariadne/protocol';
import { Controller, Get, Query } from '@nestjs/common';
import { parseQuery, windowQuerySchema } from '../common/query';
import { Tenant } from '../tenant/tenant';
import { TopologyService } from './topology.service';

@Controller('topology')
export class TopologyController {
  constructor(private readonly topology: TopologyService) {}

  @Get()
  get(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.topology.topology(tenantId, parseQuery(windowQuerySchema, raw));
  }
}
