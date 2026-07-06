import { HEADERS, tenantIdSchema, type TraceContext } from '@ariadne/protocol';
import {
  CapturingEmitter,
  makeTestRuntime,
  SequentialIdGenerator,
} from '@ariadne/transport-core/testing';
import { EventTracerKafkaSerializer } from './kafka.serializer';

describe('EventTracerKafkaSerializer', () => {
  it('starts a root trace, injects dual headers and emits a PRODUCER span', () => {
    const emitter = new CapturingEmitter();
    const runtime = makeTestRuntime({ emitter, serviceName: 'order-service' });
    const serializer = new EventTracerKafkaSerializer(runtime);

    const message = serializer.serialize({ orderId: 'ord-1' }, { pattern: 'orders.created' });

    const span = emitter.spans[0];
    expect(span?.spanKind).toBe('PRODUCER');
    expect(span?.channel).toBe('orders.created');
    expect(span?.parentSpanId).toBeNull();
    expect(span?.metadata).toEqual({ orderId: 'ord-1' });

    expect(message.value).toEqual({ orderId: 'ord-1' });
    expect(message.headers?.[HEADERS.TRACE_ID]).toBe(span?.traceId);
    expect(message.headers?.[HEADERS.SPAN_ID]).toBe(span?.spanId);
    expect(message.headers?.[HEADERS.TRACEPARENT]).toContain(span?.traceId);
  });

  it('chains the producer span to the surrounding consumer context', () => {
    const emitter = new CapturingEmitter();
    const runtime = makeTestRuntime({ emitter, serviceName: 'inventory-service' });
    const serializer = new EventTracerKafkaSerializer(runtime);
    const ids = new SequentialIdGenerator();
    const consumerCtx: TraceContext = {
      traceId: ids.newTraceId(),
      spanId: ids.newSpanId(),
      parentSpanId: null,
      tenantId: tenantIdSchema.parse('acme'),
      serviceName: 'inventory-service',
      correlationId: null,
    };

    runtime.context.run(consumerCtx, () => {
      serializer.serialize({ orderId: 'ord-1' }, { pattern: 'inventory.reserved' });
    });

    const span = emitter.spans[0];
    expect(span?.traceId).toBe(consumerCtx.traceId);
    expect(span?.parentSpanId).toBe(consumerCtx.spanId);
  });

  it('preserves an explicit kafka message shape ({ key, value })', () => {
    const emitter = new CapturingEmitter();
    const runtime = makeTestRuntime({ emitter });
    const serializer = new EventTracerKafkaSerializer(runtime);

    const message = serializer.serialize(
      { key: 'ord-1', value: { orderId: 'ord-1' } },
      { pattern: 'orders.created' }
    );

    expect(message.key).toBe('ord-1');
    expect(message.value).toEqual({ orderId: 'ord-1' });
    expect(message.headers?.[HEADERS.SERVICE_NAME]).toBe('svc-test');
  });
});
