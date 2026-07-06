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
  port: z.number().int().min(0).max(65_535),
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
    port: intFromEnv(env['PORT'], 3000),
  });
}
