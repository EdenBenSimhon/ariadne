import {
  extractTraceContext,
  injectTraceHeaders,
  redactMetadata,
  type Envelope,
  type TenantId,
  type TraceContext,
  type TransportKind,
} from '@ariadne/protocol';
import type { Capabilities } from './capabilities';
import type { ContextManager } from './context/context-manager';
import type { SpanEmitter } from './emitter/span-emitter';
import type { Clock } from './ports/clock';
import type { IdGenerator } from './ports/id-generator';
import { SpanRecorder } from './span/span-recorder';
import type {
  Handler,
  InboundEnvelope,
  RequestOptions,
  Subscription,
  Transport,
} from './transport';

/** Everything a transport needs, injected — fully swappable in tests. */
export interface TransportRuntime {
  readonly serviceName: string;
  readonly tenantId: TenantId;
  readonly emitter: SpanEmitter;
  readonly context: ContextManager;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Metadata allowlist — PII redaction at source (security B1). */
  readonly redactionAllowlist: readonly string[];
}

/**
 * Template method for all transports (spec §4). Shared behaviour — trace
 * injection, span emission, context propagation — lives here and is inherited
 * ONCE, by transport implementations only. Client services never extend this;
 * they depend on the Transport port via DI.
 *
 * Guarantees:
 * - business errors always propagate (spans record them, never swallow them);
 * - a span is emitted for every operation, success or failure (`finally`);
 * - span emission is fire-and-forget through the fail-safe emitter.
 */
export abstract class BaseTransport implements Transport {
  abstract readonly name: string;
  abstract readonly caps: Capabilities;
  protected abstract readonly transportKind: TransportKind;

  constructor(protected readonly runtime: TransportRuntime) {}

  abstract connect(): Promise<void>;
  abstract close(): Promise<void>;

  protected abstract doPublish(envelope: Envelope): Promise<void>;
  protected abstract doSubscribe(pattern: string, handler: Handler): Subscription;
  protected abstract doRequest(
    target: string,
    envelope: Envelope,
    opts?: RequestOptions
  ): Promise<Envelope>;

  async publish(envelope: Envelope): Promise<void> {
    const { ctx, traced } = this.prepareOutbound(envelope, null);
    const span = this.startSpan('PRODUCER', ctx, envelope.channel, `publish ${envelope.channel}`, envelope.payload);
    try {
      await this.doPublish(traced);
      span.ok();
    } catch (err) {
      span.error(err);
      throw err;
    } finally {
      this.runtime.emitter.emit(span.toEvent());
    }
  }

  subscribe(pattern: string, handler: Handler): Subscription {
    const wrapped: Handler = (inbound) => this.runConsumer(handler, inbound);
    return this.doSubscribe(pattern, wrapped);
  }

  async request(target: string, envelope: Envelope, opts?: RequestOptions): Promise<Envelope> {
    const correlationId = this.runtime.ids.newCorrelationId();
    const { ctx, traced } = this.prepareOutbound(envelope, correlationId);
    const span = this.startSpan('PRODUCER', ctx, target, `request ${target}`, envelope.payload);
    try {
      const reply = await this.doRequest(target, traced, opts);
      span.ok();
      return reply;
    } catch (err) {
      span.error(err);
      throw err;
    } finally {
      this.runtime.emitter.emit(span.toEvent());
    }
  }

  /** Runs the business handler inside the consumer's trace context. */
  private async runConsumer(handler: Handler, inbound: InboundEnvelope): Promise<unknown> {
    const extracted = extractTraceContext(inbound.headers);
    const ctx: TraceContext = {
      traceId: extracted?.traceId ?? this.runtime.ids.newTraceId(),
      spanId: this.runtime.ids.newSpanId(),
      parentSpanId: extracted?.spanId ?? null,
      tenantId: this.runtime.tenantId,
      serviceName: this.runtime.serviceName,
      correlationId: extracted?.correlationId ?? null,
    };
    const span = this.startSpan('CONSUMER', ctx, inbound.channel, `consume ${inbound.channel}`, inbound.payload);
    try {
      const result = await this.runtime.context.run(ctx, () => handler(inbound));
      span.ok();
      return result;
    } catch (err) {
      span.error(err);
      // The adapter owns the failure policy (ack / nack / DLQ) — rethrow.
      throw err;
    } finally {
      this.runtime.emitter.emit(span.toEvent());
    }
  }

  private prepareOutbound(
    envelope: Envelope,
    correlationId: string | null
  ): { ctx: TraceContext; traced: Envelope } {
    const current = this.runtime.context.get();
    const ctx: TraceContext = {
      traceId: current?.traceId ?? this.runtime.ids.newTraceId(),
      spanId: this.runtime.ids.newSpanId(),
      parentSpanId: current?.spanId ?? null,
      tenantId: this.runtime.tenantId,
      serviceName: this.runtime.serviceName,
      correlationId: correlationId ?? current?.correlationId ?? null,
    };
    const traced: Envelope = {
      ...envelope,
      headers: { ...envelope.headers, ...injectTraceHeaders(ctx) },
    };
    return { ctx, traced };
  }

  private startSpan(
    spanKind: 'PRODUCER' | 'CONSUMER',
    ctx: TraceContext,
    channel: string,
    operationName: string,
    payload: unknown
  ): SpanRecorder {
    return new SpanRecorder(
      {
        ctx,
        spanKind,
        transport: this.transportKind,
        channel,
        operationName,
        metadata: redactMetadata(payload, this.runtime.redactionAllowlist),
      },
      this.runtime.clock
    );
  }
}
