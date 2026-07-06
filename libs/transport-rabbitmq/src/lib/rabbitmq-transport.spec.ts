import { HEADERS, formatTraceparent, type SpanEvent } from '@ariadne/protocol';
import {
  RequestTimeoutError,
  TransportWiringError,
  type TransportRuntime,
} from '@ariadne/transport-core';
import {
  CapturingEmitter,
  SequentialIdGenerator,
  makeTestRuntime,
} from '@ariadne/transport-core/testing';
import * as amqplib from 'amqplib';
import { RabbitSpanSink } from './rabbitmq-span-sink';
import { RabbitMqTransport } from './rabbitmq-transport';

jest.mock('amqplib', () => {
  class MockChannel {
    static generated = 0;
    consumers = new Map<string, (msg: unknown) => void>();
    assertExchange = jest.fn(async () => ({}));
    assertQueue = jest.fn(async (queue: string) => ({
      queue: queue === '' ? `amq.gen-reply-${(MockChannel.generated += 1)}` : queue,
    }));
    bindQueue = jest.fn(async () => ({}));
    prefetch = jest.fn(async () => ({}));
    publish = jest.fn(() => true);
    sendToQueue = jest.fn(() => true);
    consume = jest.fn(async (queue: string, onMessage: (msg: unknown) => void) => {
      this.consumers.set(queue, onMessage);
      return { consumerTag: `tag.${queue}` };
    });
    ack = jest.fn();
    nack = jest.fn();
    close = jest.fn(async () => undefined);
  }

  class MockChannelModel {
    channels: MockChannel[] = [];
    createChannel = jest.fn(async () => {
      const channel = new MockChannel();
      this.channels.push(channel);
      return channel;
    });
    close = jest.fn(async () => undefined);

    constructor(readonly url: string) {}
  }

  const connections: MockChannelModel[] = [];
  const connect = jest.fn(async (url: string) => {
    const connection = new MockChannelModel(url);
    connections.push(connection);
    return connection;
  });

  return { connect, __connections: connections };
});

interface MockChannel {
  consumers: Map<string, (msg: unknown) => void>;
  assertExchange: jest.Mock;
  assertQueue: jest.Mock;
  bindQueue: jest.Mock;
  prefetch: jest.Mock;
  publish: jest.Mock;
  sendToQueue: jest.Mock;
  consume: jest.Mock;
  ack: jest.Mock;
  nack: jest.Mock;
  close: jest.Mock;
}

interface MockConnection {
  url: string;
  channels: MockChannel[];
  createChannel: jest.Mock;
  close: jest.Mock;
}

const mockAmqp = amqplib as unknown as { connect: jest.Mock; __connections: MockConnection[] };

function makeAmqpMessage(
  overrides: {
    headers?: Record<string, unknown>;
    routingKey?: string;
    replyTo?: string;
    correlationId?: string;
    value?: unknown;
  } = {}
) {
  return {
    content: Buffer.from(JSON.stringify(overrides.value ?? { orderId: 'ord-1' }), 'utf8'),
    fields: {
      routingKey: overrides.routingKey ?? 'orders.created',
      deliveryTag: 1,
      redelivered: false,
      exchange: 'eventtracer',
      consumerTag: 'tag',
    },
    properties: {
      headers: overrides.headers ?? {},
      correlationId: overrides.correlationId,
      replyTo: overrides.replyTo,
    },
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('RabbitMqTransport', () => {
  let emitter: CapturingEmitter;
  let runtime: TransportRuntime;
  let transport: RabbitMqTransport;

  beforeEach(() => {
    mockAmqp.__connections.length = 0;
    mockAmqp.connect.mockClear();
    emitter = new CapturingEmitter();
    runtime = makeTestRuntime({ emitter, serviceName: 'order-service' });
    transport = new RabbitMqTransport(runtime, { url: 'amqp://broker:5672' });
  });

  const connection = () => mockAmqp.__connections[0]!;
  const publishChannel = () => connection().channels[0]!;
  const consumeChannel = () => connection().channels[1]!;

  it('publishes to the topic exchange with the routing key, trace headers and persistence', async () => {
    await transport.connect();
    await transport.publish({
      channel: 'orders.created',
      headers: {},
      payload: { orderId: 'ord-1' },
    });

    expect(mockAmqp.connect).toHaveBeenCalledWith('amqp://broker:5672');
    const [exchange, routingKey, content, options] = publishChannel().publish.mock.calls.at(-1)!;
    expect(exchange).toBe('eventtracer');
    expect(routingKey).toBe('orders.created');
    expect(JSON.parse((content as Buffer).toString('utf8'))).toEqual({ orderId: 'ord-1' });
    expect(options.persistent).toBe(true);
    const span = emitter.spans[0] as SpanEvent;
    expect(options.headers[HEADERS.TRACEPARENT]).toBe(formatTraceparent(span.traceId, span.spanId));
    expect(options.headers[HEADERS.TENANT_ID]).toBe('acme');
  });

  it('asserts the exchange pair and per-pattern queue (durable, DLX-armed, bound, prefetched)', async () => {
    transport.subscribe('orders.created', () => undefined);
    await transport.connect();

    expect(publishChannel().assertExchange).toHaveBeenCalledWith('eventtracer', 'topic', {
      durable: true,
    });
    expect(publishChannel().assertExchange).toHaveBeenCalledWith('eventtracer.dlx', 'fanout', {
      durable: true,
    });
    expect(publishChannel().assertQueue).toHaveBeenCalledWith('eventtracer.dlq', { durable: true });
    expect(publishChannel().bindQueue).toHaveBeenCalledWith(
      'eventtracer.dlq',
      'eventtracer.dlx',
      ''
    );

    expect(consumeChannel().prefetch).toHaveBeenCalledWith(50);
    expect(consumeChannel().assertQueue).toHaveBeenCalledWith('svc.order-service.orders.created', {
      durable: true,
      arguments: { 'x-dead-letter-exchange': 'eventtracer.dlx' },
    });
    expect(consumeChannel().bindQueue).toHaveBeenCalledWith(
      'svc.order-service.orders.created',
      'eventtracer',
      'orders.created'
    );
    expect(consumeChannel().consume).toHaveBeenCalledWith(
      'svc.order-service.orders.created',
      expect.any(Function),
      { noAck: false }
    );
  });

  it('fails loudly when subscribing after connect() or to a duplicate pattern', async () => {
    transport.subscribe('orders.created', () => undefined);
    expect(() => transport.subscribe('orders.created', () => undefined)).toThrow(
      TransportWiringError
    );
    await transport.connect();
    expect(() => transport.subscribe('other.topic', () => undefined)).toThrow(
      TransportWiringError
    );
  });

  it('dispatches inbound messages through the tracing wrapper and acks on success', async () => {
    const seen: unknown[] = [];
    transport.subscribe('orders.created', (envelope) => {
      seen.push(envelope.payload);
    });
    await transport.connect();

    const ids = new SequentialIdGenerator();
    const traceId = ids.newTraceId();
    const parentSpanId = ids.newSpanId();
    const msg = makeAmqpMessage({
      headers: { [HEADERS.TRACEPARENT]: formatTraceparent(traceId, parentSpanId) },
    });
    consumeChannel().consumers.get('svc.order-service.orders.created')?.(msg);
    await settle();

    expect(seen).toEqual([{ orderId: 'ord-1' }]);
    expect(consumeChannel().ack).toHaveBeenCalledWith(msg);
    expect(consumeChannel().nack).not.toHaveBeenCalled();
    const span = emitter.spans[0];
    expect(span?.spanKind).toBe('CONSUMER');
    expect(span?.traceId).toBe(traceId);
    expect(span?.parentSpanId).toBe(parentSpanId);
  });

  it('nacks without requeue on handler error (broker dead-letters via the DLX) and emits an ERROR span', async () => {
    transport.subscribe('orders.created', () => {
      throw new Error('poison');
    });
    await transport.connect();

    const msg = makeAmqpMessage();
    consumeChannel().consumers.get('svc.order-service.orders.created')?.(msg);
    await settle();

    expect(consumeChannel().nack).toHaveBeenCalledWith(msg, false, false);
    expect(consumeChannel().ack).not.toHaveBeenCalled();
    expect(emitter.spans[0]?.status).toBe('ERROR');
  });

  it('replies via the default exchange when the message carries replyTo + correlationId', async () => {
    transport.subscribe('inventory.check', () => ({ available: true }));
    await transport.connect();

    const msg = makeAmqpMessage({
      routingKey: 'inventory.check',
      replyTo: 'amq.gen-caller',
      correlationId: 'corr-1',
      value: { sku: 'sku-1' },
    });
    consumeChannel().consumers.get('svc.order-service.inventory.check')?.(msg);
    await settle();

    const replyCall = publishChannel().publish.mock.calls.at(-1)!;
    const [exchange, routingKey, content, options] = replyCall;
    expect(exchange).toBe('');
    expect(routingKey).toBe('amq.gen-caller');
    expect(JSON.parse((content as Buffer).toString('utf8'))).toEqual({ available: true });
    expect(options.correlationId).toBe('corr-1');
    expect(options.headers[HEADERS.CORRELATION_ID]).toBe('corr-1');
    expect(consumeChannel().ack).toHaveBeenCalledWith(msg);
  });

  it('performs native request/reply over an exclusive reply queue and correlation id', async () => {
    await transport.connect();
    const pending = transport.request('inventory.check', {
      channel: 'inventory.check',
      headers: {},
      payload: { sku: 'sku-1' },
    });
    await settle();

    expect(consumeChannel().assertQueue).toHaveBeenCalledWith('', { exclusive: true });
    const replyQueue = [...consumeChannel().consumers.keys()].find((q) =>
      q.startsWith('amq.gen-')
    )!;
    expect(replyQueue).toBeDefined();

    const [exchange, routingKey, , options] = publishChannel().publish.mock.calls.at(-1)!;
    expect(exchange).toBe('eventtracer');
    expect(routingKey).toBe('inventory.check');
    expect(options.replyTo).toBe(replyQueue);
    const correlationId = options.correlationId as string;
    expect(correlationId).toMatch(/^[0-9a-f]{16}$/);
    expect(options.headers[HEADERS.CORRELATION_ID]).toBe(correlationId);

    consumeChannel().consumers.get(replyQueue)?.(
      makeAmqpMessage({ value: { available: true }, correlationId, routingKey: replyQueue })
    );

    const reply = await pending;
    expect(reply.payload).toEqual({ available: true });
    expect(emitter.spans[0]?.spanKind).toBe('PRODUCER');
    expect(emitter.spans[0]?.status).toBe('OK');
  });

  it('rejects a request that receives no reply within the timeout', async () => {
    await transport.connect();
    await expect(
      transport.request(
        'inventory.check',
        { channel: 'inventory.check', headers: {}, payload: {} },
        { timeoutMs: 10 }
      )
    ).rejects.toThrow(RequestTimeoutError);
    expect(emitter.spans[0]?.status).toBe('ERROR');
  });
});

describe('RabbitSpanSink', () => {
  beforeEach(() => {
    mockAmqp.__connections.length = 0;
    mockAmqp.connect.mockClear();
  });

  it('runs on its own AMQP connection and sends each span to the durable _tracing queue', async () => {
    const runtime = makeTestRuntime({ serviceName: 'order-service' });
    const transport = new RabbitMqTransport(runtime, { url: 'amqp://broker:5672' });
    await transport.connect();
    const sink = new RabbitSpanSink({ url: 'amqp://broker:5672' });

    const span = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
    } as unknown as Parameters<typeof sink.sendBatch>[0][number];
    await sink.sendBatch([span]);

    // One connection for the transport, a SEPARATE one for tracing (fail-safe rule).
    expect(mockAmqp.__connections).toHaveLength(2);
    const sinkChannel = mockAmqp.__connections[1]!.channels[0]!;
    expect(sinkChannel.assertQueue).toHaveBeenCalledWith('_tracing', { durable: true });
    const [queue, content, options] = sinkChannel.sendToQueue.mock.calls[0]!;
    expect(queue).toBe('_tracing');
    expect(JSON.parse((content as Buffer).toString('utf8'))).toMatchObject({
      spanId: 'b'.repeat(16),
    });
    expect(options.persistent).toBe(true);
    expect(mockAmqp.__connections[0]!.channels[0]!.sendToQueue).not.toHaveBeenCalled();

    await sink.close();
    expect(mockAmqp.__connections[1]!.close).toHaveBeenCalled();
  });
});
