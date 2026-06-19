import { SpanEvent, SpanEventSchema } from './schemas';

/** Parse and validate a span event, throwing if it is malformed (spec §3, §8/§10 boundary). */
export function parseSpanEvent(input: unknown): SpanEvent {
  return SpanEventSchema.parse(input);
}

/**
 * Safely parse a span event without throwing — the guard the collector uses at the
 * `_tracing` ingestion boundary to reject malformed/untrusted events.
 */
export function safeParseSpanEvent(
  input: unknown
):
  | { success: true; data: SpanEvent }
  | { success: false; error: string } {
  const result = SpanEventSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error.message };
}
