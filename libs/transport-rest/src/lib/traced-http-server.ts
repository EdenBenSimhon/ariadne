import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  extractTraceContext,
  redactMetadata,
  type Envelope,
  type TraceContext,
} from '@ariadne/protocol';
import { SpanRecorder, type Handler, type TransportRuntime } from '@ariadne/transport-core';

/**
 * The server side of REST's native request/reply (spec §7): a minimal traced
 * HTTP listener. Incoming trace headers become the CONSUMER span's parent and
 * the business handler runs inside the trace context, so anything it
 * publishes downstream chains correctly — handlers stay free of tracing code.
 *
 * Deliberately tiny (JSON POST routes only): production services keep their
 * own framework and get the same behaviour from the SDK's HTTP hook; this
 * exists for replies in service meshes and for the demo mesh.
 */
export interface RestRoutes {
  readonly [path: string]: Handler;
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > maxBytes) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function flattenHeaders(request: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0];
  }
  return out;
}

export function createTracedRestServer(
  runtime: TransportRuntime,
  routes: RestRoutes,
  options: { maxBodyBytes?: number } = {}
): Server {
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;

  return createServer((request, response) => {
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const handler = request.method === 'POST' ? routes[path] : undefined;
    if (handler === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    const headers = flattenHeaders(request);
    const extracted = extractTraceContext(headers);
    const ctx: TraceContext = {
      traceId: extracted?.traceId ?? runtime.ids.newTraceId(),
      spanId: runtime.ids.newSpanId(),
      parentSpanId: extracted?.spanId ?? null,
      tenantId: runtime.tenantId,
      serviceName: runtime.serviceName,
      correlationId: extracted?.correlationId ?? null,
    };

    let payload: unknown = null;
    try {
      const body = await readBody(request, maxBodyBytes);
      payload = body.length > 0 ? JSON.parse(body) : null;
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid request body' }));
      return;
    }

    const span = new SpanRecorder(
      {
        ctx,
        spanKind: 'CONSUMER',
        transport: 'rest',
        channel: path,
        operationName: `handle ${path}`,
        metadata: redactMetadata(payload, runtime.redactionAllowlist),
      },
      runtime.clock
    );

    const envelope: Envelope = { channel: path, headers, payload };
    try {
      const result = await runtime.context.run(ctx, () => handler(envelope));
      span.ok();
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result ?? null));
    } catch (err) {
      span.error(err);
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'internal error' }));
    } finally {
      runtime.emitter.emit(span.toEvent());
    }
  }
}
