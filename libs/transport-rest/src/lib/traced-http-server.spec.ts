import type { Server } from 'node:http';
import { HEADERS, formatTraceparent } from '@ariadne/protocol';
import {
  CapturingEmitter,
  makeTestRuntime,
  SequentialIdGenerator,
} from '@ariadne/transport-core/testing';
import { createTracedRestServer } from './traced-http-server';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('createTracedRestServer', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve));
    server = null;
  });

  it('adopts inbound trace headers, runs the handler in context, emits a CONSUMER span', async () => {
    const emitter = new CapturingEmitter();
    const runtime = makeTestRuntime({ emitter, serviceName: 'order-service' });
    const ids = new SequentialIdGenerator();
    const traceId = ids.newTraceId();
    const parentSpanId = ids.newSpanId();
    let contextInsideHandler: string | null = null;

    server = createTracedRestServer(runtime, {
      '/payments/confirm': (envelope) => {
        contextInsideHandler = runtime.context.get()?.traceId ?? null;
        return { confirmed: true, orderId: (envelope.payload as { orderId: string }).orderId };
      },
    });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/payments/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [HEADERS.TRACEPARENT]: formatTraceparent(traceId, parentSpanId),
      },
      body: JSON.stringify({ orderId: 'ord-1', creditCard: '4111' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confirmed: true, orderId: 'ord-1' });
    expect(contextInsideHandler).toBe(traceId);

    const span = emitter.spans[0];
    expect(span?.spanKind).toBe('CONSUMER');
    expect(span?.transport).toBe('rest');
    expect(span?.channel).toBe('/payments/confirm');
    expect(span?.traceId).toBe(traceId);
    expect(span?.parentSpanId).toBe(parentSpanId);
    // Redaction still applies at the REST boundary.
    expect(span?.metadata).toEqual({ orderId: 'ord-1' });
  });

  it('records an ERROR span and answers 500 when the handler throws', async () => {
    const emitter = new CapturingEmitter();
    const runtime = makeTestRuntime({ emitter });
    server = createTracedRestServer(runtime, {
      '/boom': () => {
        throw new Error('kaput');
      },
    });
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/boom`, {
      method: 'POST',
      body: '{}',
    });

    expect(response.status).toBe(500);
    expect(emitter.spans[0]?.status).toBe('ERROR');
    expect(emitter.spans[0]?.error).toBe('Error: kaput');
  });

  it('404s unknown routes and 400s malformed bodies without emitting spans', async () => {
    const emitter = new CapturingEmitter();
    const runtime = makeTestRuntime({ emitter });
    server = createTracedRestServer(runtime, { '/known': () => 'ok' });
    const port = await listen(server);

    const missing = await fetch(`http://127.0.0.1:${port}/nope`, { method: 'POST', body: '{}' });
    expect(missing.status).toBe(404);

    const malformed = await fetch(`http://127.0.0.1:${port}/known`, {
      method: 'POST',
      body: 'not json {',
    });
    expect(malformed.status).toBe(400);
    expect(emitter.spans).toHaveLength(0);
  });
});
