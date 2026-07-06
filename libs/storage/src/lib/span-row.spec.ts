import { parseSpanEvent, type SpanEvent } from '@ariadne/protocol';
import { spanEventToRow, type SpanRow } from './span-row';

function validEvent(): SpanEvent {
  const result = parseSpanEvent({
    traceId: 'f'.repeat(32),
    spanId: '1'.repeat(16),
    parentSpanId: null,
    tenantId: 'acme',
    serviceName: 'order-service',
    spanKind: 'PRODUCER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: 'publish orders.created',
    startTime: '2026-07-06T10:00:00.050Z',
    durationMs: 70,
    status: 'OK',
    error: null,
    metadata: { orderId: 'ord-123' },
  });
  if (!result.success) throw new Error('fixture is invalid');
  return result.data;
}

describe('spanEventToRow', () => {
  it('maps every protocol field and converts startTime to a Date', () => {
    const event = validEvent();
    const row = spanEventToRow(event);

    // Branded types flow through InferInsertModel without casts.
    const typed: SpanRow = row;
    expect(typed.tenantId).toBe(event.tenantId);
    expect(typed.spanId).toBe(event.spanId);
    expect(typed.traceId).toBe(event.traceId);
    expect(typed.parentSpanId).toBeNull();
    expect(typed.startTime).toEqual(new Date('2026-07-06T10:00:00.050Z'));
    expect(typed.durationMs).toBe(70);
    expect(typed.metadata).toEqual({ orderId: 'ord-123' });
    expect(typed.receivedAt).toBeUndefined();
  });
});
