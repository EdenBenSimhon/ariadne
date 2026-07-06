import { HEADERS, formatTraceparent, type Envelope } from '@ariadne/protocol';
import { CapturingEmitter } from '../testing/capturing-emitter';
import { FakeTransport, InMemoryBus } from '../testing/fake-transport';
import { makeTestRuntime } from '../testing/runtime';
import { SequentialIdGenerator } from '../testing/sequential-ids';

function envelope(channel: string, payload: unknown = {}): Envelope {
  return { channel, headers: {}, payload };
}

describe('BaseTransport', () => {
  it('starts a new root trace when publishing outside any context', async () => {
    const emitter = new CapturingEmitter();
    const transport = new FakeTransport(makeTestRuntime({ emitter }), new InMemoryBus());

    await transport.publish(envelope('orders.created'));

    expect(emitter.spans).toHaveLength(1);
    const span = emitter.spans[0];
    expect(span?.spanKind).toBe('PRODUCER');
    expect(span?.parentSpanId).toBeNull();
    expect(span?.status).toBe('OK');
    expect(span?.channel).toBe('orders.created');
    expect(span?.tenantId).toBe('acme');
    expect(span?.serviceName).toBe('svc-test');
  });

  it('stamps dual trace headers on the outbound envelope', async () => {
    const emitter = new CapturingEmitter();
    const bus = new InMemoryBus();
    const transport = new FakeTransport(makeTestRuntime({ emitter }), bus);
    let seen: Envelope | null = null;
    bus.register('orders.created', (e) => {
      seen = e;
    });

    await transport.publish(envelope('orders.created'));

    const span = emitter.spans[0];
    const headers = (seen as Envelope | null)?.headers ?? {};
    expect(headers[HEADERS.TRACEPARENT]).toBe(
      formatTraceparent(span!.traceId, span!.spanId)
    );
    expect(headers[HEADERS.TRACE_ID]).toBe(span?.traceId);
    expect(headers[HEADERS.SPAN_ID]).toBe(span?.spanId);
    expect(headers[HEADERS.SERVICE_NAME]).toBe('svc-test');
    expect(headers[HEADERS.TENANT_ID]).toBe('acme');
  });

  it('adopts inbound trace context for the consumer span and exposes it to the handler flow', async () => {
    const emitter = new CapturingEmitter();
    const bus = new InMemoryBus();
    const runtime = makeTestRuntime({ emitter });
    const transport = new FakeTransport(runtime, bus);
    const ids = new SequentialIdGenerator();
    const inboundTraceId = ids.newTraceId();
    const inboundSpanId = ids.newSpanId();

    transport.subscribe('orders.created', () => undefined);
    await bus.deliver({
      channel: 'orders.created',
      headers: { [HEADERS.TRACEPARENT]: formatTraceparent(inboundTraceId, inboundSpanId) },
      payload: {},
    });

    const span = emitter.spans[0];
    expect(span?.spanKind).toBe('CONSUMER');
    expect(span?.traceId).toBe(inboundTraceId);
    expect(span?.parentSpanId).toBe(inboundSpanId);
  });

  it('records an ERROR span and rethrows when the handler fails', async () => {
    const emitter = new CapturingEmitter();
    const bus = new InMemoryBus();
    const transport = new FakeTransport(makeTestRuntime({ emitter }), bus);
    transport.subscribe('orders.created', () => {
      throw new Error('boom');
    });

    await expect(bus.deliver(envelope('orders.created'))).rejects.toThrow('boom');
    const span = emitter.spans[0];
    expect(span?.status).toBe('ERROR');
    expect(span?.error).toBe('Error: boom');
  });

  it('records an ERROR span and rethrows when doPublish fails', async () => {
    const emitter = new CapturingEmitter();
    class BrokenTransport extends FakeTransport {
      protected override doPublish(): Promise<void> {
        return Promise.reject(new Error('wire down'));
      }
    }
    const transport = new BrokenTransport(makeTestRuntime({ emitter }), new InMemoryBus());

    await expect(transport.publish(envelope('orders.created'))).rejects.toThrow('wire down');
    expect(emitter.spans[0]?.status).toBe('ERROR');
  });

  it('redacts payload metadata through the allowlist (PII never leaves the adapter)', async () => {
    const emitter = new CapturingEmitter();
    const transport = new FakeTransport(makeTestRuntime({ emitter }), new InMemoryBus());

    await transport.publish(
      envelope('orders.created', { orderId: 'ord-1', creditCard: '4111-1111-1111-1111' })
    );

    expect(emitter.spans[0]?.metadata).toEqual({ orderId: 'ord-1' });
  });
});
