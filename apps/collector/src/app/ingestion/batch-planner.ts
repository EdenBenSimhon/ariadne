import { parseSpanEvent, type SpanEvent } from '@ariadne/protocol';

/**
 * Pure planning of one Kafka batch: validate untrusted messages (security B1)
 * and chunk valid spans into DB-write-sized groups whose offsets can be
 * resolved exactly when their write commits. No I/O, no clocks — fully
 * deterministic and unit-testable.
 */
export interface PlannerMessage {
  readonly offset: string;
  readonly value: Buffer | null;
}

export interface PlannerOptions {
  /** Max spans per DB write (spec §8: 100). */
  readonly maxChunkSpans: number;
  /** Pre-parse size guard — oversized payloads are never parsed. */
  readonly maxMessageBytes: number;
  /** Accepted span-age window: keeps startTime inside existing partitions. */
  readonly maxSpanAgeMs: number;
  readonly maxSpanFutureMs: number;
  /** Injected epoch ms. */
  readonly now: number;
}

export type InvalidReason =
  | 'empty'
  | 'oversized'
  | 'bad-json'
  | 'schema'
  | 'timestamp-out-of-range';

export interface PlannedChunk {
  readonly spans: readonly SpanEvent[];
  /** Offset to resolve once this chunk is committed — covers interleaved invalids. */
  readonly resolveUpToOffset: string;
}

export interface BatchPlan {
  readonly chunks: readonly PlannedChunk[];
  /**
   * Offset of the batch's last message; resolved after all chunks succeed so
   * trailing invalid messages are marked handled (they are counted, not retried).
   * Null for an empty batch.
   */
  readonly finalOffset: string | null;
  readonly invalid: {
    readonly count: number;
    readonly reasons: Readonly<Partial<Record<InvalidReason, number>>>;
  };
}

function classify(
  message: PlannerMessage,
  opts: PlannerOptions
): { span: SpanEvent } | { reason: InvalidReason } {
  if (message.value === null || message.value.length === 0) return { reason: 'empty' };
  if (message.value.length > opts.maxMessageBytes) return { reason: 'oversized' };

  let payload: unknown;
  try {
    payload = JSON.parse(message.value.toString('utf8'));
  } catch {
    return { reason: 'bad-json' };
  }

  const parsed = parseSpanEvent(payload);
  if (!parsed.success) return { reason: 'schema' };

  // startTime is attacker-controlled: outside the window it would target a
  // nonexistent partition and turn one forged message into an INSERT-failure
  // loop. Reject here instead (counted, offset resolved, never retried).
  const startTime = Date.parse(parsed.data.startTime);
  if (startTime < opts.now - opts.maxSpanAgeMs || startTime > opts.now + opts.maxSpanFutureMs) {
    return { reason: 'timestamp-out-of-range' };
  }

  return { span: parsed.data };
}

export function planBatch(
  messages: readonly PlannerMessage[],
  opts: PlannerOptions
): BatchPlan {
  const chunks: PlannedChunk[] = [];
  const reasons: Partial<Record<InvalidReason, number>> = {};
  let invalidCount = 0;
  let currentSpans: SpanEvent[] = [];

  for (const message of messages) {
    const outcome = classify(message, opts);
    if ('reason' in outcome) {
      invalidCount += 1;
      reasons[outcome.reason] = (reasons[outcome.reason] ?? 0) + 1;
      continue;
    }
    currentSpans.push(outcome.span);
    if (currentSpans.length >= opts.maxChunkSpans) {
      // Everything up to and including this message (invalids included) is
      // handled once this chunk commits.
      chunks.push({ spans: currentSpans, resolveUpToOffset: message.offset });
      currentSpans = [];
    }
  }

  const lastMessage = messages[messages.length - 1];
  if (currentSpans.length > 0 && lastMessage !== undefined) {
    chunks.push({ spans: currentSpans, resolveUpToOffset: lastMessage.offset });
  }

  return {
    chunks,
    finalOffset: lastMessage?.offset ?? null,
    invalid: { count: invalidCount, reasons },
  };
}
