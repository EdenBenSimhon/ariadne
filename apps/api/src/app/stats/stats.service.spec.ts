import { tenantIdSchema } from '@ariadne/protocol';
import type { StatsRow, TraceReader } from '@ariadne/storage';
import { loadApiConfig } from '../config/api-config';
import { StatsService } from './stats.service';

const tenant = tenantIdSchema.parse('acme');

function makeService(row: StatsRow) {
  const reader = { getStats: jest.fn(async () => row) } as unknown as TraceReader;
  return new StatsService(reader, loadApiConfig({}));
}

describe('StatsService', () => {
  it('computes the error rate and echoes the resolved window', async () => {
    const stats = await makeService({
      traceCount: 4,
      errorTraceCount: 1,
      avgDurationMs: 120.5,
      p50DurationMs: 100,
      p95DurationMs: 300,
      spanCount: 24,
      serviceCount: 3,
    }).stats(tenant, {});
    expect(stats.errorRate).toBe(0.25);
    expect(stats.from).toMatch(/^\d{4}-/);
    expect(stats.to).toMatch(/^\d{4}-/);
  });

  it('returns zero error rate and null percentiles on an empty window (no NaN)', async () => {
    const stats = await makeService({
      traceCount: 0,
      errorTraceCount: 0,
      avgDurationMs: null,
      p50DurationMs: null,
      p95DurationMs: null,
      spanCount: 0,
      serviceCount: 0,
    }).stats(tenant, {});
    expect(stats.errorRate).toBe(0);
    expect(stats.p95DurationMs).toBeNull();
  });
});
