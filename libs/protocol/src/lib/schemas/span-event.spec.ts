import { newSpanId, newTraceId } from '../ids';
import { parseSpanEvent, spanEventSchema, type SpanEvent } from './span-event';

function validEvent(): Record<string, unknown> {
  return {
    traceId: newTraceId(),
    spanId: newSpanId(),
    parentSpanId: newSpanId(),
    tenantId: 'acme',
    serviceName: 'inventory-service',
    spanKind: 'CONSUMER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: 'handleOrderCreated',
    startTime: '2026-05-31T10:00:00.050Z',
    durationMs: 70,
    status: 'OK',
    error: null,
    metadata: { orderId: 'ord-123' },
  };
}

describe('spanEventSchema', () => {
  it('parses the golden valid event (spec §3 example shape)', () => {
    const result = parseSpanEvent(validEvent());
    expect(result.success).toBe(true);
  });

  it('accepts a root span (parentSpanId null) and null metadata', () => {
    const result = parseSpanEvent({ ...validEvent(), parentSpanId: null, metadata: null });
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys (strict object — ingestion boundary B1/B2)', () => {
    expect(parseSpanEvent({ ...validEvent(), smuggled: 'x' }).success).toBe(false);
  });

  it.each([
    ['bad spanKind', { spanKind: 'CLIENT' }],
    ['bad transport', { transport: 'sqs' }],
    ['bad status', { status: 'FAILED' }],
    ['non-ISO startTime', { startTime: 'yesterday' }],
    ['negative duration', { durationMs: -1 }],
    ['fractional duration', { durationMs: 1.5 }],
    ['absurd duration', { durationMs: 999_999_999_999 }],
    ['uppercase tenant', { tenantId: 'ACME' }],
    ['traceId in spanId field', { spanId: 'f'.repeat(32) }],
    ['nested metadata object', { metadata: { user: { name: 'a' } } }],
    ['oversized metadata value', { metadata: { k: 'x'.repeat(300) } }],
  ])('rejects %s', (_name, patch) => {
    expect(parseSpanEvent({ ...validEvent(), ...patch }).success).toBe(false);
  });

  it('rejects metadata with more keys than the limit', () => {
    const metadata = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i]));
    expect(parseSpanEvent({ ...validEvent(), metadata }).success).toBe(false);
  });

  describe('status ⟺ error invariant', () => {
    it("rejects status OK with an error message", () => {
      expect(parseSpanEvent({ ...validEvent(), status: 'OK', error: 'boom' }).success).toBe(false);
    });

    it("rejects status ERROR with error null", () => {
      expect(parseSpanEvent({ ...validEvent(), status: 'ERROR', error: null }).success).toBe(false);
    });

    it("accepts status ERROR with an error message", () => {
      expect(parseSpanEvent({ ...validEvent(), status: 'ERROR', error: 'boom' }).success).toBe(true);
    });
  });

  it('brands ids at the type level', () => {
    const event: SpanEvent = spanEventSchema.parse(validEvent());
    // @ts-expect-error a SpanId is not assignable where a TraceId is required
    const wrong: typeof event.traceId = event.spanId;
    expect(wrong).toBeDefined();
  });
});
