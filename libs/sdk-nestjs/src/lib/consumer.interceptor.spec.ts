import {
  formatTraceparent,
  HEADERS,
  type TraceContext,
} from '@ariadne/protocol';
import {
  CapturingEmitter,
  makeTestRuntime,
  SequentialIdGenerator,
} from '@ariadne/transport-core/testing';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, firstValueFrom, of, throwError } from 'rxjs';
import { EventTracerConsumerInterceptor } from './consumer.interceptor';

const ids = new SequentialIdGenerator();

function rpcContext(headers: Record<string, string>, data: unknown = {}): ExecutionContext {
  const kafkaContext = {
    getMessage: () => ({ headers }),
    getTopic: () => 'orders.created',
  };
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getContext: () => kafkaContext,
      getData: () => data,
    }),
  } as unknown as ExecutionContext;
}

describe('EventTracerConsumerInterceptor', () => {
  it('adopts inbound trace context and exposes it to the handler via ALS', async () => {
    const emitter = new CapturingEmitter();
    const runtime = makeTestRuntime({ emitter, serviceName: 'inventory-service' });
    const interceptor = new EventTracerConsumerInterceptor(runtime);

    const traceId = ids.newTraceId();
    const parentSpanId = ids.newSpanId();
    let handlerContext: TraceContext | null = null;
    const next: CallHandler = {
      handle: () =>
        defer(() => {
          handlerContext = runtime.context.get();
          return of('handled');
        }),
    };

    const result = await firstValueFrom(
      interceptor.intercept(
        rpcContext(
          { [HEADERS.TRACEPARENT]: formatTraceparent(traceId, parentSpanId) },
          { orderId: 'ord-1' }
        ),
        next
      )
    );

    expect(result).toBe('handled');
    expect(handlerContext).not.toBeNull();
    expect(handlerContext!.traceId).toBe(traceId);
    expect(handlerContext!.parentSpanId).toBe(parentSpanId);

    expect(emitter.spans).toHaveLength(1);
    const span = emitter.spans[0];
    expect(span?.spanKind).toBe('CONSUMER');
    expect(span?.channel).toBe('orders.created');
    expect(span?.traceId).toBe(traceId);
    expect(span?.parentSpanId).toBe(parentSpanId);
    expect(span?.metadata).toEqual({ orderId: 'ord-1' });
    expect(span?.status).toBe('OK');
  });

  it('records an ERROR span and propagates the handler error', async () => {
    const emitter = new CapturingEmitter();
    const runtime = makeTestRuntime({ emitter });
    const interceptor = new EventTracerConsumerInterceptor(runtime);
    const next: CallHandler = { handle: () => throwError(() => new Error('boom')) };

    await expect(
      firstValueFrom(interceptor.intercept(rpcContext({}), next))
    ).rejects.toThrow('boom');

    expect(emitter.spans[0]?.status).toBe('ERROR');
    expect(emitter.spans[0]?.error).toBe('Error: boom');
  });

  it('passes non-rpc (HTTP) calls straight through without spans', async () => {
    const emitter = new CapturingEmitter();
    const runtime = makeTestRuntime({ emitter });
    const interceptor = new EventTracerConsumerInterceptor(runtime);
    const httpContext = { getType: () => 'http' } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of('http-result') };

    await expect(firstValueFrom(interceptor.intercept(httpContext, next))).resolves.toBe(
      'http-result'
    );
    expect(emitter.spans).toHaveLength(0);
  });
});
