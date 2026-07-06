import type { SpanEvent } from '@ariadne/protocol';
import { CapabilityError, type Transport } from '@ariadne/transport-core';
import {
  CapturingEmitter,
  FakeTransport,
  InMemoryBus,
  makeTestRuntime,
} from '@ariadne/transport-core/testing';
import { Test } from '@nestjs/testing';
import { EventTracerModule } from './event-tracer.module';
import { EVENT_TRACER_TRANSPORT } from './tokens';

describe('EventTracerModule (zero-touch wiring)', () => {
  it('traces a cross-service chain through the injected Transport port', async () => {
    const bus = new InMemoryBus();
    const emitter = new CapturingEmitter();

    const moduleRef = await Test.createTestingModule({
      imports: [
        EventTracerModule.forRoot({
          serviceName: 'order-service',
          tenantId: 'acme',
          redaction: { allowlist: ['orderId'] },
          transportFactory: (runtime) => new FakeTransport(runtime, bus),
          emitterFactory: () => emitter,
        }),
      ],
    }).compile();
    await moduleRef.init();

    // A second "service" on the same bus, sharing the span collector.
    const inventorySvc = new FakeTransport(
      makeTestRuntime({ emitter, serviceName: 'inventory-service' }),
      bus
    );
    inventorySvc.subscribe('orders.created', async () => {
      await inventorySvc.publish({ channel: 'inventory.reserved', headers: {}, payload: {} });
    });

    const transport = moduleRef.get<Transport>(EVENT_TRACER_TRANSPORT);
    await transport.publish({ channel: 'orders.created', headers: {}, payload: { orderId: 'ord-1' } });

    expect(emitter.spans).toHaveLength(3);
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

    expect(new Set(emitter.spans.map((s) => s.traceId)).size).toBe(1);
    expect(s1.parentSpanId).toBeNull();
    expect(s2.parentSpanId).toBe(s1.spanId);
    expect(s3.parentSpanId).toBe(s2.spanId);
    expect(s1.metadata).toEqual({ orderId: 'ord-1' });

    await moduleRef.close();
  });

  it('fails loudly at wiring time when a required capability is missing', async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          EventTracerModule.forRoot({
            serviceName: 'order-service',
            tenantId: 'acme',
            requires: { reqreply: true },
            transportFactory: (runtime) => new FakeTransport(runtime, new InMemoryBus()),
            emitterFactory: () => new CapturingEmitter(),
          }),
        ],
      }).compile()
    ).rejects.toThrow(CapabilityError);
  });

  it('fails loudly at wiring time on an invalid tenant id', async () => {
    await expect(
      Test.createTestingModule({
        imports: [
          EventTracerModule.forRoot({
            serviceName: 'order-service',
            tenantId: 'NOT VALID!',
            transportFactory: (runtime) => new FakeTransport(runtime, new InMemoryBus()),
            emitterFactory: () => new CapturingEmitter(),
          }),
        ],
      }).compile()
    ).rejects.toThrow();
  });

  it('connects the transport on bootstrap and flushes the emitter on shutdown', async () => {
    const emitter = new CapturingEmitter();
    const closeSpy = jest.spyOn(emitter, 'close');
    let connected = false;
    let closed = false;

    class ObservableFake extends FakeTransport {
      override async connect(): Promise<void> {
        connected = true;
      }
      override async close(): Promise<void> {
        closed = true;
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [
        EventTracerModule.forRoot({
          serviceName: 'order-service',
          tenantId: 'acme',
          transportFactory: (runtime) => new ObservableFake(runtime, new InMemoryBus()),
          emitterFactory: () => emitter,
        }),
      ],
    }).compile();

    await moduleRef.init();
    expect(connected).toBe(true);

    await moduleRef.close();
    expect(closed).toBe(true);
    expect(closeSpy).toHaveBeenCalled();
  });
});
