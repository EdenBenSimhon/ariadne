import type { TenantId } from '@ariadne/protocol';
import type { StatsSummary } from '@ariadne/graph';
import type { TraceReader } from '@ariadne/storage';
import { Inject, Injectable } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { resolveWindow, type WindowQuery } from '../common/query';
import { TRACE_READER } from '../storage/storage.module';

@Injectable()
export class StatsService {
  constructor(
    @Inject(TRACE_READER) private readonly reader: TraceReader,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  async stats(tenantId: TenantId, query: WindowQuery): Promise<StatsSummary> {
    const window = resolveWindow(query, {
      lookbackMs: this.config.defaultLookbackHours * 3_600_000,
      maxWindowMs: this.config.maxWindowDays * 86_400_000,
    });
    const row = await this.reader.getStats(tenantId, window);
    return {
      traceCount: row.traceCount,
      errorTraceCount: row.errorTraceCount,
      errorRate: row.traceCount > 0 ? row.errorTraceCount / row.traceCount : 0,
      spanCount: row.spanCount,
      serviceCount: row.serviceCount,
      avgDurationMs: row.avgDurationMs,
      p50DurationMs: row.p50DurationMs,
      p95DurationMs: row.p95DurationMs,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
    };
  }
}
