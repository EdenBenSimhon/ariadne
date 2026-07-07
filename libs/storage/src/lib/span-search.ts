import type { SpanId, SpanKind, SpanStatus, TransportKind } from '@ariadne/protocol';

/**
 * Log-search filter over raw spans (the "logger view" of the system). Every
 * search is tenant-scoped and time-bounded — the window is REQUIRED so a
 * filterless query can never scan the full partitioned table (B3 cost cap).
 */
export interface SpanSearchFilter {
  readonly limit: number;
  /** Keyset cursor — strictly older than this (start_time, span_id) pair. */
  readonly cursor?: { readonly startTime: Date; readonly spanId: SpanId };
  /** Case-insensitive substring over operation_name, channel and error. */
  readonly q?: string;
  readonly service?: string;
  readonly channel?: string;
  readonly status?: SpanStatus;
  readonly transport?: TransportKind;
  readonly spanKind?: SpanKind;
  readonly minDurationMs?: number;
  /** Metadata filter: key must exist; value (when given) must match as text. */
  readonly metaKey?: string;
  readonly metaValue?: string;
  readonly from: Date;
  readonly to: Date;
}

/** Per-service aggregate for the search window — powers filter dropdowns and the agent's service analysis. */
export interface ServiceSummaryRow {
  readonly serviceName: string;
  readonly spanCount: number;
  readonly errorCount: number;
  readonly avgDurationMs: number | null;
  readonly p95DurationMs: number | null;
  readonly channels: readonly string[];
}

/** Escape LIKE metacharacters so user text is matched literally. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
