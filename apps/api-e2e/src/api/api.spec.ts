import axios, { AxiosError } from 'axios';

/**
 * E2E against a running API (`npx nx serve api`) backed by compose Postgres
 * with migrations applied. Seed data first via `node tools/smoke/seed-tracing.mjs`
 * with the collector running — see README "Local dev".
 */
const TENANT = { headers: { 'x-tenant-id': 'acme' } };

describe('GET /api/healthz', () => {
  it('reports database health', async () => {
    const res = await axios.get('/api/healthz');
    expect(res.status).toBe(200);
    expect(res.data.db).toBe('ok');
  });
});

describe('tenancy (security B3)', () => {
  it('rejects requests without a tenant header — no default tenant', async () => {
    const err = await axios.get('/api/traces').catch((e: AxiosError) => e);
    expect((err as AxiosError).response?.status).toBe(400);
  });

  it('rejects an invalid tenant header', async () => {
    const err = await axios
      .get('/api/traces', { headers: { 'x-tenant-id': 'NOT VALID!' } })
      .catch((e: AxiosError) => e);
    expect((err as AxiosError).response?.status).toBe(400);
  });

  it('isolates tenants — another tenant sees nothing', async () => {
    const res = await axios.get('/api/traces', { headers: { 'x-tenant-id': 'someone-else' } });
    expect(res.status).toBe(200);
    expect(res.data.items).toEqual([]);
  });
});

describe('GET /api/traces', () => {
  it('lists traces newest-first with a cursor contract', async () => {
    const res = await axios.get('/api/traces?limit=1', TENANT);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.items)).toBe(true);
    expect(res.data).toHaveProperty('nextCursor');
  });

  it('rejects an out-of-bounds limit', async () => {
    const err = await axios.get('/api/traces?limit=10000', TENANT).catch((e: AxiosError) => e);
    expect((err as AxiosError).response?.status).toBe(400);
  });

  it('400s on a malformed trace id and 404s on an unknown one', async () => {
    const bad = await axios.get('/api/traces/nope', TENANT).catch((e: AxiosError) => e);
    expect((bad as AxiosError).response?.status).toBe(400);
    const missing = await axios
      .get(`/api/traces/${'0'.repeat(31)}1`, TENANT)
      .catch((e: AxiosError) => e);
    expect((missing as AxiosError).response?.status).toBe(404);
  });
});

describe('GET /api/topology and /api/stats', () => {
  it('returns the aggregated service graph shape', async () => {
    const res = await axios.get('/api/topology', TENANT);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array) });
  });

  it('returns bounded stats', async () => {
    const res = await axios.get('/api/stats', TENANT);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty('traceCount');
    expect(res.data).toHaveProperty('errorRate');
  });
});
