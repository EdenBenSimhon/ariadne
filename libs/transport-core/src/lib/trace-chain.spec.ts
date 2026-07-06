import { spanEventSchema, type Envelope, type SpanEvent } from '@ariadne/protocol';
import { CapturingEmitter } from '../testing/capturing-emitter';
import { FakeTransport, InMemoryBus } from '../testing/fake-transport';
import { makeTestRuntime } from '../testing/runtime';
import { SequentialIdGenerator } from '../testing/sequential-ids';

/**
 * Phase-2 acceptance test — the spec §1 worked example in miniature:
 * order-service publishes orders.created → inventory-service consumes it and
 * publishes inventory.reserved → payment-service consumes that. One traceId,
 * a strict parentSpanId chain, alternating PRODUCER/CONSUMER kinds — and the
 * "services" contain zero tracing code.
 */
describe('end-to-end trace chain over an in-memory mesh', () => {
  it('stitches one connected trace across three services', async () => {
    const bus = new InMemoryBus();
    const emitter = new CapturingEmitter();
    const ids = new SequentialIdGenerator();

    const orderSvc = new FakeTransport(
      makeTestRuntime({ emitter, ids, serviceName: 'order-service' }),
      bus
    );
    const inventorySvc = new FakeTransport(
      makeTestRuntime({ emitter, ids, serviceName: 'inventory-service' }),
      bus
    );
    const paymentSvc = new FakeTransport(
      makeTestRuntime({ emitter, ids, serviceName: 'payment-service' }),
      bus
    );

    // Pure business handlers — no tracing code anywhere below.
    inventorySvc.subscribe('orders.created', async (e: Envelope) => {
      await inventorySvc.publish({ channel: 'inventory.reserved', headers: {}, payload: e.payload });
    });
    paymentSvc.subscribe('inventory.reserved', () => undefined);

    await orderSvc.publish({ channel: 'orders.created', headers: {}, payload: { orderId: 'ord-123' } });

    expect(emitter.spans).toHaveLength(4);
    for (const span of emitter.spans) {
      expect(spanEventSchema.safeParse(span).success).toBe(true);
    }

    const find = (serviceName: string, spanKind: string): SpanEvent => {
      const span = emitter.spans.find(
        (s) => s.serviceName === serviceName && s.spanKind === spanKind
      );
      if (!span) throw new Error(`missing span ${serviceName}/${spanKind}`);
      return span;
    };

    const s1 = find('order-service', 'PRODUCER');
    const s2 = find('inventory-service', 'CONSUMER');
    const s3 = find('inventory-service', 'PRODUCER');
    const s4 = find('payment-service', 'CONSUMER');

    // One trace across all services.
    const traceIds = new Set(emitter.spans.map((s) => s.traceId));
    expect(traceIds.size).toBe(1);

    // The parentSpanId chain: null → S1 → S2 → S3.
    expect(s1.parentSpanId).toBeNull();
    expect(s2.parentSpanId).toBe(s1.spanId);
    expect(s3.parentSpanId).toBe(s2.spanId);
    expect(s4.parentSpanId).toBe(s3.spanId);

    // Channels line up with the hop that produced them.
    expect(s1.channel).toBe('orders.created');
    expect(s2.channel).toBe('orders.created');
    expect(s3.channel).toBe('inventory.reserved');
    expect(s4.channel).toBe('inventory.reserved');

    // Redaction: orderId survives the allowlist on every span.
    expect(s1.metadata).toEqual({ orderId: 'ord-123' });
  });
});
