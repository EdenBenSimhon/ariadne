import { HEADERS, formatTraceparent, type SpanEvent } from '@ariadne/protocol';
import {
  CapabilityError,
  RequestTimeoutError,
  type TransportRuntime,
} from '@ariadne/transport-core';
import { CapturingEmitter, makeTestRuntime } from '@ariadne/transport-core/testing';
import { RestTransport } from './rest-transport';

describe('RestTransport', () => {
  let emitter: CapturingEmitter;
  let runtime: TransportRuntime;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    emitter = new CapturingEmitter();
    runtime = makeTestRuntime({ emitter, serviceName: 'order-service' });
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    });

  it('POSTs JSON with trace headers and static extras, and emits a PRODUCER span for rest', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ available: true }));
    const transport = new RestTransport(runtime, {
      headers: { authorization: 'Bearer token-1' },
    });
    await transport.connect();

    await transport.request('http://inventory:3000/check', {
      channel: 'inventory.check',
      headers: {},
      payload: { sku: 'sku-1' },
    });

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://inventory:3000/check');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ sku: 'sku-1' }));
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const headers = init.headers as Record<string, string>;
    const span = emitter.spans[0] as SpanEvent;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['authorization']).toBe('Bearer token-1');
    expect(headers[HEADERS.TRACEPARENT]).toBe(formatTraceparent(span.traceId, span.spanId));
    expect(headers[HEADERS.TRACE_ID]).toBe(span.traceId);
    expect(headers[HEADERS.SPAN_ID]).toBe(span.spanId);
    expect(headers[HEADERS.SERVICE_NAME]).toBe('order-service');
    expect(headers[HEADERS.TENANT_ID]).toBe('acme');
    expect(headers[HEADERS.CORRELATION_ID]).toMatch(/^[0-9a-f]{16}$/);

    expect(span.spanKind).toBe('PRODUCER');
    expect(span.transport).toBe('rest');
    expect(span.status).toBe('OK');
  });

  it('resolves the reply as an Envelope with parsed JSON and lowercased response headers', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-1' },
      })
    );
    const transport = new RestTransport(runtime);

    const reply = await transport.request('http://inventory:3000/check', {
      channel: 'inventory.check',
      headers: {},
      payload: {},
    });

    expect(reply.channel).toBe('http://inventory:3000/check');
    expect(reply.payload).toEqual({ available: true });
    expect(reply.headers['content-type']).toBe('application/json');
    expect(reply.headers['x-request-id']).toBe('req-1');
  });

  it('resolves relative targets against the configured baseUrl', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ ok: true }));
    const transport = new RestTransport(runtime, { baseUrl: 'http://inventory:3000' });

    await transport.request('/inventory/check', {
      channel: 'inventory.check',
      headers: {},
      payload: {},
    });

    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://inventory:3000/inventory/check');
  });

  it('rejects on a non-2xx response and records an ERROR span', async () => {
    fetchSpy.mockResolvedValue(new Response('boom', { status: 500 }));
    const transport = new RestTransport(runtime);

    await expect(
      transport.request('http://inventory:3000/check', {
        channel: 'inventory.check',
        headers: {},
        payload: {},
      })
    ).rejects.toThrow("request to 'http://inventory:3000/check' failed with HTTP 500");
    expect(emitter.spans[0]?.status).toBe('ERROR');
  });

  it('maps an aborted request to RequestTimeoutError', async () => {
    fetchSpy.mockRejectedValue(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    );
    const transport = new RestTransport(runtime);

    await expect(
      transport.request(
        'http://inventory:3000/check',
        { channel: 'inventory.check', headers: {}, payload: {} },
        { timeoutMs: 10 }
      )
    ).rejects.toThrow(RequestTimeoutError);
    expect(emitter.spans[0]?.status).toBe('ERROR');
  });

  it('throws CapabilityError for publish and subscribe (pubsub is none for MVP)', async () => {
    const transport = new RestTransport(runtime);
    await expect(
      transport.publish({ channel: 'orders.created', headers: {}, payload: {} })
    ).rejects.toThrow(CapabilityError);
    expect(() => transport.subscribe('orders.created', () => undefined)).toThrow(CapabilityError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
