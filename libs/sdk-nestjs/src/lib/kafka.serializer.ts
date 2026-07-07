import {
  injectTraceHeaders,
  redactMetadata,
  type TraceContext,
} from '@ariadne/protocol';
import { SpanRecorder, type TransportRuntime } from '@ariadne/transport-core';
import { Inject, Injectable } from '@nestjs/common';
import type { Serializer } from '@nestjs/microservices';
import { EVENT_TRACER_RUNTIME } from './tokens';

interface KafkaMessageLike {
  key?: unknown;
  value: unknown;
  headers?: Record<string, string>;
}

function toKafkaMessage(value: unknown): KafkaMessageLike {
  if (value !== null && typeof value === 'object' && 'value' in value) {
    return value as KafkaMessageLike;
  }
  return { value };
}

/**
 * Producers commonly emit `value: JSON.stringify(event)`, so the payload
 * reaching the serializer is a string. Parse it (best-effort) before
 * redaction so PRODUCER spans capture the same allowlisted message fields as
 * CONSUMER spans do.
 */
function payloadForRedaction(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Zero-touch producer hook for apps using Nest's ClientKafka: registration is
 * config-only (`serializer` in the ClientsModule options), business emit()
 * calls stay untouched (spec §6). Injects dual trace headers and emits the
 * PRODUCER span, chained to the current ALS context.
 */
@Injectable()
export class EventTracerKafkaSerializer implements Serializer<unknown, KafkaMessageLike> {
  constructor(@Inject(EVENT_TRACER_RUNTIME) private readonly runtime: TransportRuntime) {}

  serialize(value: unknown, options?: { pattern?: string }): KafkaMessageLike {
    const message = toKafkaMessage(value);
    const channel = options?.pattern ?? 'unknown';
    const current = this.runtime.context.get();
    const ctx: TraceContext = {
      traceId: current?.traceId ?? this.runtime.ids.newTraceId(),
      spanId: this.runtime.ids.newSpanId(),
      parentSpanId: current?.spanId ?? null,
      tenantId: this.runtime.tenantId,
      serviceName: this.runtime.serviceName,
      correlationId: current?.correlationId ?? null,
    };
    const span = new SpanRecorder(
      {
        ctx,
        spanKind: 'PRODUCER',
        transport: 'kafka',
        channel,
        operationName: `publish ${channel}`,
        metadata: redactMetadata(
          payloadForRedaction(message.value),
          this.runtime.redactionAllowlist
        ),
      },
      this.runtime.clock
    );
    span.ok();
    this.runtime.emitter.emit(span.toEvent());
    return {
      ...message,
      headers: { ...message.headers, ...injectTraceHeaders(ctx) },
    };
  }
}
