import type { SpanId, TraceId } from '@ariadne/protocol';
import type { IdGenerator } from '../lib/ports/id-generator';

/**
 * Deterministic ids: trace-1 = 000…001 (32 hex), span-1 = 000…001 (16 hex).
 * Valid protocol ids (lowercase hex, never all-zero), stable across runs.
 */
export class SequentialIdGenerator implements IdGenerator {
  private traces = 0;
  private spans = 0;
  private correlations = 0;

  newTraceId(): TraceId {
    this.traces += 1;
    return this.traces.toString(16).padStart(32, '0') as TraceId;
  }

  newSpanId(): SpanId {
    this.spans += 1;
    return this.spans.toString(16).padStart(16, '0') as SpanId;
  }

  newCorrelationId(): string {
    this.correlations += 1;
    return this.correlations.toString(16).padStart(16, '0');
  }
}
