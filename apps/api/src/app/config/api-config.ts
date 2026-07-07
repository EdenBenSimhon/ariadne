import { z } from 'zod';

/** API_* env config, validated at boot — malformed values fail startup loudly. */
const apiConfigSchema = z.object({
  databaseUrl: z.string().min(1),
  /** Encryption in transit toward Postgres (security B2); off for local compose. */
  dbSsl: z.boolean(),
  maxPageSize: z.number().int().min(1).max(1_000),
  defaultPageSize: z.number().int().min(1),
  /** Span-row cap for topology aggregation; responses flag `truncated` beyond it. */
  topologyMaxRows: z.number().int().min(1),
  defaultLookbackHours: z.number().int().min(1),
  maxWindowDays: z.number().int().min(1),
  /** How often the live-events poller checks for new traces (ms). */
  liveStreamPollMs: z.number().int().min(200).max(60_000),
  /** Traces the poller scans per tick / default SSE backfill size. */
  liveStreamBackfill: z.number().int().min(1).max(500),
  port: z.number().int().min(0).max(65_535),
  /**
   * Per-tenant API keys (security B3): API_KEYS="tenant:key,tenant2:key2".
   * Empty map = auth disabled (local dev). Keys must be non-trivial.
   */
  apiKeys: z.record(z.string().min(1), z.string().min(16)),
  /** Requests per tenant (or IP) per minute; 0 disables (dev/tests). */
  rateLimitPerMinute: z.number().int().min(0).max(100_000),
  /** Browser origins allowed by CORS; '*' reflects any origin (dev only). */
  corsOrigins: z.array(z.string().min(1)).min(1),
  /** Emit Strict-Transport-Security — enable once the API sits behind TLS. */
  enableHsts: z.boolean(),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;

export const API_CONFIG = Symbol('API_CONFIG');

function intFromEnv(value: string | undefined, fallback: number): number {
  return value === undefined ? fallback : Number(value);
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean | string {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value; // fails schema validation with a clear error
}

/** "tenant:key,tenant2:key2" → { tenant: key, ... }; malformed pairs fail loudly. */
function apiKeysFromEnv(value: string | undefined): Record<string, string> {
  if (value === undefined || value.trim() === '') return {};
  const entries = value.split(',').map((pair) => {
    const separator = pair.indexOf(':');
    if (separator <= 0) throw new Error(`API_KEYS entry "${pair.slice(0, 8)}…" is not tenant:key`);
    return [pair.slice(0, separator).trim(), pair.slice(separator + 1).trim()] as const;
  });
  return Object.fromEntries(entries);
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return apiConfigSchema.parse({
    // The API connects with the SELECT-only reader role (security B2/B3).
    databaseUrl:
      env['API_DATABASE_URL'] ??
      'postgres://eventtracer_reader:reader_dev@localhost:5432/eventtracer',
    dbSsl: boolFromEnv(env['API_DB_SSL'], false),
    maxPageSize: intFromEnv(env['API_MAX_PAGE_SIZE'], 100),
    defaultPageSize: intFromEnv(env['API_DEFAULT_PAGE_SIZE'], 20),
    topologyMaxRows: intFromEnv(env['API_TOPOLOGY_MAX_ROWS'], 50_000),
    defaultLookbackHours: intFromEnv(env['API_DEFAULT_LOOKBACK_HOURS'], 24),
    maxWindowDays: intFromEnv(env['API_MAX_WINDOW_DAYS'], 31),
    liveStreamPollMs: intFromEnv(env['API_LIVE_POLL_MS'], 1_000),
    liveStreamBackfill: intFromEnv(env['API_LIVE_BACKFILL'], 25),
    port: intFromEnv(env['PORT'], 3000),
    apiKeys: apiKeysFromEnv(env['API_KEYS']),
    rateLimitPerMinute: intFromEnv(env['API_RATE_LIMIT_PER_MINUTE'], 600),
    corsOrigins: (env['API_CORS_ORIGINS'] ?? '*').split(',').map((origin) => origin.trim()),
    enableHsts: boolFromEnv(env['API_ENABLE_HSTS'], false),
  });
}
