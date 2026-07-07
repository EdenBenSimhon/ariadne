import type { SpanEvent } from '@ariadne/protocol';

export interface InsertResult {
  received: number;
  inserted: number;
  /** Rows skipped by the idempotent upsert — replays / redeliveries (B2). */
  duplicates: number;
}

/**
 * The storage port. PgTraceStore is the Postgres implementation; a ClickHouse
 * drop-in at very high volume (spec §8) implements this same interface and
 * swaps in via the collector's DI provider.
 */
export interface TraceStore {
  /** Idempotent, order-independent batch write of validated span events. */
  insertSpans(spans: readonly SpanEvent[]): Promise<InsertResult>;
  /**
   * Drop span partitions and delete trace/alert rows older than keepDays.
   * Runs via the SECURITY DEFINER `eventtracer_retention` function (migration
   * 0004) — the collector role has EXECUTE on it but owns no table.
   * Returns the number of partitions dropped.
   */
  runRetention(keepDays: number): Promise<number>;
  ping(): Promise<void>;
  close(): Promise<void>;
}
