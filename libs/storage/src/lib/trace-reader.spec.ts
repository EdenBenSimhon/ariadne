import { tenantIdSchema, traceIdSchema } from '@ariadne/protocol';
import type { Pool, QueryArrayConfig } from 'pg';
import { TraceReader } from './trace-reader';

/**
 * SQL-shape tests: drizzle executes through pool.query — a capturing fake
 * pool records every statement + params without any database.
 */
function capturingPool(): { pool: Pool; queries: Array<{ text: string; values: unknown[] }> } {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const pool = {
    query: jest.fn(async (config: QueryArrayConfig | string, values?: unknown[]) => {
      const text = typeof config === 'string' ? config : config.text;
      const params = values ?? (typeof config === 'string' ? [] : ((config.values as unknown[]) ?? []));
      queries.push({ text, values: params });
      return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
    }),
    end: jest.fn(async () => undefined),
  } as unknown as Pool;
  return { pool, queries };
}

const tenant = tenantIdSchema.parse('acme');
const traceId = traceIdSchema.parse('f'.repeat(32));

describe('TraceReader SQL shape', () => {
  function setup() {
    const { pool, queries } = capturingPool();
    // drizzle only needs an object with .query for node-postgres.
    const { drizzle } = jest.requireActual<typeof import('drizzle-orm/node-postgres')>(
      'drizzle-orm/node-postgres'
    );
    const db = drizzle(pool);
    const reader = new TraceReader(db as never, pool);
    return { reader, queries };
  }

  it('always filters by tenant — every method (B3 pin)', async () => {
    const { reader, queries } = setup();
    const window = { from: new Date('2026-07-06T00:00:00Z'), to: new Date('2026-07-07T00:00:00Z') };

    await reader.listTraces(tenant, { limit: 20 });
    await reader.getTrace(tenant, traceId);
    await reader.getSpansForTrace(tenant, traceId);
    await reader.getSpansForTopology(tenant, { ...window, maxRows: 100 });
    await reader.getStats(tenant, window);

    expect(queries.length).toBeGreaterThanOrEqual(6); // getStats runs two
    for (const query of queries) {
      expect(query.text).toContain('tenant_id');
      expect(query.values).toContain('acme');
    }
  });

  it('paginates with a keyset predicate and start_time leading (index-friendly)', async () => {
    const { reader, queries } = setup();
    await reader.listTraces(tenant, {
      limit: 10,
      cursor: { startTime: new Date('2026-07-06T12:00:00Z'), traceId },
    });
    const text = queries[0]?.text ?? '';
    expect(text).toMatch(/"start_time" < .+ or .+"start_time" = .+ and .+"trace_id" </is);
    expect(text).toMatch(/order by .*"start_time" desc.*"trace_id" desc/is);
    expect(text).toContain('limit');
    // limit+1 for nextCursor derivation
    expect(queries[0]?.values).toContain(11);
  });

  it('combines root service, error and window filters', async () => {
    const { reader, queries } = setup();
    await reader.listTraces(tenant, {
      limit: 5,
      rootService: 'order-service',
      hasError: true,
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-07T00:00:00Z'),
    });
    const text = queries[0]?.text ?? '';
    expect(text).toContain('root_service');
    expect(text).toContain('has_error');
    expect(text).toMatch(/"start_time" >=/);
    expect(text).toMatch(/"start_time" <=/);
  });

  it('projects topology spans without the metadata column', async () => {
    const { reader, queries } = setup();
    await reader.getSpansForTopology(tenant, {
      from: new Date('2026-07-06T00:00:00Z'),
      to: new Date('2026-07-07T00:00:00Z'),
      maxRows: 1000,
    });
    const text = queries[0]?.text ?? '';
    expect(text).not.toContain('metadata');
    expect(queries[0]?.values).toContain(1001);
  });

  it('computes stats with percentile_cont and error-filtered counts', async () => {
    const { reader, queries } = setup();
    const stats = await reader.getStats(tenant, {
      from: new Date('2026-07-06T00:00:00Z'),
      to: new Date('2026-07-07T00:00:00Z'),
    });
    const combined = queries.map((q) => q.text).join('\n');
    expect(combined).toContain('percentile_cont(0.5)');
    expect(combined).toContain('percentile_cont(0.95)');
    expect(combined).toMatch(/count\(\*\) filter \(where "has_error"\)/i);
    // Empty result set → zeros/nulls, never NaN.
    expect(stats).toEqual({
      traceCount: 0,
      errorTraceCount: 0,
      avgDurationMs: null,
      p50DurationMs: null,
      p95DurationMs: null,
      spanCount: 0,
      serviceCount: 0,
    });
  });
});
