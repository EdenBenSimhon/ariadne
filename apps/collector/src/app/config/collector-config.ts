import { TRACING_CHANNEL } from '@ariadne/protocol';
import { z } from 'zod';

/**
 * All collector tuning comes from COLLECTOR_* env vars, validated at boot —
 * a malformed value fails startup loudly instead of silently falling back.
 */
const collectorConfigSchema = z.object({
  brokers: z.array(z.string().min(1)).min(1),
  groupId: z.string().min(1),
  tracingTopic: z.string().min(1),
  databaseUrl: z.string().min(1),
  /** Encryption in transit toward Postgres (security B2); off for local compose. */
  dbSsl: z.boolean(),
  /** Spec §8: batch 100 spans — realized as the max DB-write chunk size. */
  batchMaxSpans: z.number().int().min(1).max(10_000),
  /** Spec §8: …or 500 ms — realized as the broker fetch `maxWaitTimeInMs`. */
  batchMaxWaitMs: z.number().int().min(1).max(60_000),
  batchMinBytes: z.number().int().min(1),
  /** Pre-parse size guard for untrusted messages (B1). */
  maxMessageBytes: z.number().int().min(1),
  /** Accepted span-age window — must stay inside the pre-created partition range. */
  maxSpanAgeMs: z.number().int().min(0),
  maxSpanFutureMs: z.number().int().min(0),
  dbRetryAttempts: z.number().int().min(1).max(20),
  fromBeginning: z.boolean(),
  port: z.number().int().min(0).max(65_535),
  /** Days of span/trace history to keep; 0 disables the retention sweep. */
  retentionDays: z.union([z.literal(0), z.number().int().min(7).max(3_650)]),
});

export type CollectorConfig = z.infer<typeof collectorConfigSchema>;

export const COLLECTOR_CONFIG = Symbol('COLLECTOR_CONFIG');

function intFromEnv(value: string | undefined, fallback: number): number {
  return value === undefined ? fallback : Number(value);
}

function boolFromEnv(value: string | undefined, fallback: boolean): boolean | string {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value; // fails schema validation with a clear error
}

export function loadCollectorConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  return collectorConfigSchema.parse({
    brokers: (env['COLLECTOR_KAFKA_BROKERS'] ?? 'localhost:9092')
      .split(',')
      .map((broker) => broker.trim())
      .filter((broker) => broker.length > 0),
    groupId: env['COLLECTOR_KAFKA_GROUP_ID'] ?? 'eventtracer-collector-group',
    tracingTopic: env['COLLECTOR_TRACING_TOPIC'] ?? TRACING_CHANNEL,
    databaseUrl:
      env['COLLECTOR_DATABASE_URL'] ??
      'postgres://eventtracer_collector:collector_dev@localhost:5432/eventtracer',
    dbSsl: boolFromEnv(env['COLLECTOR_DB_SSL'], false),
    batchMaxSpans: intFromEnv(env['COLLECTOR_BATCH_MAX_SPANS'], 100),
    batchMaxWaitMs: intFromEnv(env['COLLECTOR_BATCH_MAX_WAIT_MS'], 500),
    batchMinBytes: intFromEnv(env['COLLECTOR_BATCH_MIN_BYTES'], 64 * 1024),
    maxMessageBytes: intFromEnv(env['COLLECTOR_MAX_MESSAGE_BYTES'], 64 * 1024),
    maxSpanAgeMs: intFromEnv(env['COLLECTOR_MAX_SPAN_AGE_DAYS'], 7) * 86_400_000,
    maxSpanFutureMs: intFromEnv(env['COLLECTOR_MAX_SPAN_FUTURE_MS'], 86_400_000),
    dbRetryAttempts: intFromEnv(env['COLLECTOR_DB_RETRY_ATTEMPTS'], 5),
    fromBeginning: boolFromEnv(env['COLLECTOR_FROM_BEGINNING'], true),
    port: intFromEnv(env['PORT'], 3001),
    retentionDays: intFromEnv(env['COLLECTOR_RETENTION_DAYS'], 30),
  });
}
