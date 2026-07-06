import type {
  RequiredCapabilities,
  SpanEmitter,
  Transport,
  TransportRuntime,
} from '@ariadne/transport-core';
import type { KafkaTransportConfig } from '@ariadne/transport-kafka';
import type { InjectionToken, ModuleMetadata, OptionalFactoryDependency } from '@nestjs/common';

export interface EventTracerOptions {
  /** Stamped as x-service-name on every hop. Validated at wiring time. */
  readonly serviceName: string;
  /** Multi-tenancy from day one: keys every span. Validated at wiring time. */
  readonly tenantId: string;
  readonly transport?: {
    readonly kafka: KafkaTransportConfig;
  };
  /** Metadata allowlist — PII redaction at source (security B1). Default: keep nothing. */
  readonly redaction?: {
    readonly allowlist: readonly string[];
  };
  readonly emitter?: {
    readonly maxBufferSpans?: number;
    readonly maxBatchSize?: number;
    readonly flushIntervalMs?: number;
  };
  /** Capabilities the app relies on — mismatches throw at wiring time, not runtime. */
  readonly requires?: RequiredCapabilities;
  /** Test seam / custom transport: replaces the built-in Kafka factory. */
  readonly transportFactory?: (runtime: TransportRuntime) => Transport;
  /** Test seam: replaces the BoundedSpanEmitter → KafkaSpanSink pipeline. */
  readonly emitterFactory?: () => SpanEmitter;
}

export interface EventTracerAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useFactory: (...args: never[]) => EventTracerOptions | Promise<EventTracerOptions>;
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
}
