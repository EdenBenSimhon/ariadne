import type { TenantId } from '@ariadne/protocol';
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { parseQuery } from '../common/query';
import { Tenant } from '../tenant/tenant';
import { FlowsService } from './flows.service';

const flowsQuerySchema = z.object({
  sampleSize: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['ok', 'error']).optional(),
});

const flowChangesQuerySchema = z.object({
  sampleSize: z.coerce.number().int().min(1).max(100).default(50),
  windowHours: z.coerce.number().int().min(1).max(168).default(24),
});

@Controller()
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  @Get('flows')
  getFlows(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.flows.flows(tenantId, parseQuery(flowsQuerySchema, raw));
  }

  /** Flow drift between the last windowHours and the windowHours before it. */
  @Get('flows/changes')
  getFlowChanges(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.flows.changes(tenantId, parseQuery(flowChangesQuerySchema, raw));
  }

  @Get('anomalies')
  getAnomalies(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.flows.anomalies(tenantId, parseQuery(flowsQuerySchema, raw));
  }
}
