import type { TenantId } from '@ariadne/protocol';
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { parseQuery, windowQuerySchema } from '../common/query';
import { Tenant } from '../tenant/tenant';
import { makeSpansQuerySchema } from './spans-query';
import { SpansService } from './spans.service';

@Controller()
export class SpansController {
  private readonly querySchema;

  constructor(
    private readonly spans: SpansService,
    @Inject(API_CONFIG) config: ApiConfig
  ) {
    this.querySchema = makeSpansQuerySchema(config.maxPageSize, config.defaultPageSize);
  }

  /** Logger-style span search: free text + structured filters, keyset paginated. */
  @Get('spans')
  search(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.spans.search(tenantId, parseQuery(this.querySchema, raw));
  }

  /** One trace's spans as log entries with redacted metadata (data-change inspection). */
  @Get('traces/:id/spans')
  traceSpans(@Tenant() tenantId: TenantId, @Param('id') id: string) {
    return this.spans.traceSpans(tenantId, id);
  }

  /** Per-service aggregates for the window — powers filter dropdowns + the agent. */
  @Get('services')
  services(@Tenant() tenantId: TenantId, @Query() raw: Record<string, string>) {
    return this.spans.services(tenantId, parseQuery(windowQuerySchema, raw));
  }
}
