import {
  extractTraceContext,
  redactMetadata,
  type TraceContext,
} from '@ariadne/protocol';
import { SpanRecorder, type TransportRuntime } from '@ariadne/transport-core';
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { EVENT_TRACER_RUNTIME } from './tokens';

/**
 * Zero-touch consumer hook for apps using @nestjs/microservices
 * (@MessagePattern handlers). Registered globally by EventTracerModule; the
 * user's handlers stay untouched (spec §6).
 *
 * KafkaContext is duck-typed so @nestjs/microservices stays a peer
 * dependency; non-rpc calls (HTTP) pass straight through.
 */
interface KafkaContextLike {
  getMessage(): { headers?: Record<string, unknown> };
  getTopic(): string;
}

function isKafkaContextLike(value: unknown): value is KafkaContextLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as KafkaContextLike).getMessage === 'function' &&
    typeof (value as KafkaContextLike).getTopic === 'function'
  );
}

function normalizeHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[key] = value;
    else if (Buffer.isBuffer(value)) out[key] = value.toString('utf8');
  }
  return out;
}

@Injectable()
export class EventTracerConsumerInterceptor implements NestInterceptor {
  constructor(@Inject(EVENT_TRACER_RUNTIME) private readonly runtime: TransportRuntime) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') return next.handle();
    const rpc = context.switchToRpc();
    const transportContext: unknown = rpc.getContext();
    if (!isKafkaContextLike(transportContext)) return next.handle();

    const topic = transportContext.getTopic();
    const headers = normalizeHeaders(transportContext.getMessage().headers);
    const extracted = extractTraceContext(headers);
    const ctx: TraceContext = {
      traceId: extracted?.traceId ?? this.runtime.ids.newTraceId(),
      spanId: this.runtime.ids.newSpanId(),
      parentSpanId: extracted?.spanId ?? null,
      tenantId: this.runtime.tenantId,
      serviceName: this.runtime.serviceName,
      correlationId: extracted?.correlationId ?? null,
    };
    const span = new SpanRecorder(
      {
        ctx,
        spanKind: 'CONSUMER',
        transport: 'kafka',
        channel: topic,
        operationName: `consume ${topic}`,
        metadata: redactMetadata(rpc.getData(), this.runtime.redactionAllowlist),
      },
      this.runtime.clock
    );

    // next.handle() runs the handler lazily on subscribe — the ALS context
    // must wrap the subscribe call itself, not just this method body.
    return new Observable((subscriber) => {
      const subscription = this.runtime.context.run(ctx, () =>
        next
          .handle()
          .pipe(
            tap({
              error: (err: unknown) => span.error(err),
              complete: () => span.ok(),
            })
          )
          .subscribe({
            next: (value) => subscriber.next(value),
            error: (err: unknown) => {
              this.runtime.emitter.emit(span.toEvent());
              subscriber.error(err);
            },
            complete: () => {
              this.runtime.emitter.emit(span.toEvent());
              subscriber.complete();
            },
          })
      );
      return () => subscription.unsubscribe();
    });
  }
}
