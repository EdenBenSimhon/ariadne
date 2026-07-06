import type { InsertResult } from '@ariadne/storage';
import { Injectable, Logger } from '@nestjs/common';
import type { BatchPlan } from './batch-planner';

export interface IngestionCounters {
  spansIngested: number;
  spansDuplicate: number;
  spansInvalid: number;
  invalidByReason: Record<string, number>;
  batchesWritten: number;
  dbRetries: number;
  rowFallbackFailures: number;
  lastBatchAt: string | null;
}

const INVALID_LOG_INTERVAL_MS = 30_000;

/** In-process counters surfaced on /healthz; Prometheus export comes later. */
@Injectable()
export class IngestionMetrics {
  private readonly logger = new Logger('Ingestion');
  private lastInvalidLogAt = Number.NEGATIVE_INFINITY;
  private readonly counters: IngestionCounters = {
    spansIngested: 0,
    spansDuplicate: 0,
    spansInvalid: 0,
    invalidByReason: {},
    batchesWritten: 0,
    dbRetries: 0,
    rowFallbackFailures: 0,
    lastBatchAt: null,
  };

  recordInvalid(invalid: BatchPlan['invalid'], now = Date.now()): void {
    if (invalid.count === 0) return;
    this.counters.spansInvalid += invalid.count;
    for (const [reason, count] of Object.entries(invalid.reasons)) {
      this.counters.invalidByReason[reason] =
        (this.counters.invalidByReason[reason] ?? 0) + (count ?? 0);
    }
    // Rate-limited, reason kinds only — never the raw payload (log injection).
    if (now - this.lastInvalidLogAt >= INVALID_LOG_INTERVAL_MS) {
      this.lastInvalidLogAt = now;
      this.logger.warn(
        `rejected ${this.counters.spansInvalid} invalid span message(s) so far: ${JSON.stringify(this.counters.invalidByReason)}`
      );
    }
  }

  recordWrite(result: InsertResult): void {
    this.counters.spansIngested += result.inserted;
    this.counters.spansDuplicate += result.duplicates;
    this.counters.batchesWritten += 1;
    this.counters.lastBatchAt = new Date().toISOString();
  }

  recordDbRetry(): void {
    this.counters.dbRetries += 1;
  }

  recordRowFallbackFailure(count: number): void {
    this.counters.rowFallbackFailures += count;
    this.counters.spansInvalid += count;
  }

  snapshot(): Readonly<IngestionCounters> {
    return { ...this.counters, invalidByReason: { ...this.counters.invalidByReason } };
  }
}
