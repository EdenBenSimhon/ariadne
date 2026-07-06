import { serviceNameSchema, tenantIdSchema } from '@ariadne/protocol';
import {
  AsyncLocalStorageContextManager,
  BoundedSpanEmitter,
  DefaultIdGenerator,
  NoopSpanEmitter,
  SystemClock,
  TransportWiringError,
  assertCapabilities,
  type SpanEmitter,
  type Transport,
  type TransportRuntime,
} from '@ariadne/transport-core';
import { KafkaSpanSink, KafkaTransport } from '@ariadne/transport-kafka';
import type { Provider } from '@nestjs/common';
import type { EventTracerOptions } from './event-tracer.options';
import { EVENT_TRACER_OPTIONS, EVENT_TRACER_RUNTIME, EVENT_TRACER_TRANSPORT } from './tokens';

function buildEmitter(options: EventTracerOptions, serviceName: string): SpanEmitter {
  if (options.emitterFactory) return options.emitterFactory();
  const kafka = options.transport?.kafka;
  if (!kafka) return new NoopSpanEmitter();
  // Fail-safe pipeline: bounded buffer in front of a dedicated tracing producer.
  return new BoundedSpanEmitter(
    new KafkaSpanSink({
      brokers: kafka.brokers,
      clientId: kafka.clientId ?? serviceName,
      ...(kafka.ssl !== undefined ? { ssl: kafka.ssl } : {}),
      ...(kafka.sasl !== undefined ? { sasl: kafka.sasl } : {}),
    }),
    options.emitter ?? {}
  );
}

export function buildRuntime(options: EventTracerOptions): TransportRuntime {
  // Wiring-time validation: bad config must never reach the message path.
  const serviceName = serviceNameSchema.parse(options.serviceName);
  const tenantId = tenantIdSchema.parse(options.tenantId);
  return {
    serviceName,
    tenantId,
    emitter: buildEmitter(options, serviceName),
    context: new AsyncLocalStorageContextManager(),
    clock: new SystemClock(),
    ids: new DefaultIdGenerator(),
    redactionAllowlist: options.redaction?.allowlist ?? [],
  };
}

export function buildTransport(options: EventTracerOptions, runtime: TransportRuntime): Transport {
  const transport = options.transportFactory
    ? options.transportFactory(runtime)
    : options.transport?.kafka
      ? new KafkaTransport(runtime, options.transport.kafka)
      : null;
  if (!transport) {
    throw new TransportWiringError(
      'EventTracerModule: no transport configured — set options.transport.kafka or provide a transportFactory'
    );
  }
  // Spec §4: capability mismatch fails loudly at wiring time, not at runtime.
  assertCapabilities(options.requires ?? {}, transport.caps, transport.name);
  return transport;
}

export const eventTracerCoreProviders: Provider[] = [
  {
    provide: EVENT_TRACER_RUNTIME,
    useFactory: buildRuntime,
    inject: [EVENT_TRACER_OPTIONS],
  },
  {
    provide: EVENT_TRACER_TRANSPORT,
    useFactory: (options: EventTracerOptions, runtime: TransportRuntime) =>
      buildTransport(options, runtime),
    inject: [EVENT_TRACER_OPTIONS, EVENT_TRACER_RUNTIME],
  },
];
