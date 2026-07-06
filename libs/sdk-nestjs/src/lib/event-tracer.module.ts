import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventTracerConsumerInterceptor } from './consumer.interceptor';
import type { EventTracerAsyncOptions, EventTracerOptions } from './event-tracer.options';
import { EventTracerKafkaSerializer } from './kafka.serializer';
import { EventTracerLifecycle } from './lifecycle.service';
import { eventTracerCoreProviders } from './providers';
import { EventTracerService } from './tracer.service';
import { EVENT_TRACER_OPTIONS, EVENT_TRACER_RUNTIME, EVENT_TRACER_TRANSPORT } from './tokens';

/**
 * Zero-touch integration (spec §5/§6): importing this module is the ONLY
 * change a client service makes. Handlers and business services stay free of
 * tracing code — the consumer interceptor is registered globally here, the
 * producer path is traced inside the Transport port / Kafka serializer.
 *
 * ```ts
 * @Module({
 *   imports: [EventTracerModule.forRoot({
 *     serviceName: 'order-service',
 *     tenantId: 'acme',
 *     transport: { kafka: { brokers: ['localhost:9092'] } },
 *   })],
 * })
 * export class AppModule {}
 * ```
 */
@Module({})
export class EventTracerModule {
  static forRoot(options: EventTracerOptions): DynamicModule {
    return this.build({ provide: EVENT_TRACER_OPTIONS, useValue: options });
  }

  static forRootAsync(options: EventTracerAsyncOptions): DynamicModule {
    return this.build(
      {
        provide: EVENT_TRACER_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      },
      options.imports
    );
  }

  private static build(
    optionsProvider: Provider,
    imports: DynamicModule['imports'] = []
  ): DynamicModule {
    return {
      module: EventTracerModule,
      global: true,
      imports,
      providers: [
        optionsProvider,
        ...eventTracerCoreProviders,
        EventTracerLifecycle,
        EventTracerService,
        EventTracerKafkaSerializer,
        { provide: APP_INTERCEPTOR, useClass: EventTracerConsumerInterceptor },
      ],
      exports: [
        EVENT_TRACER_TRANSPORT,
        EVENT_TRACER_RUNTIME,
        EventTracerService,
        EventTracerKafkaSerializer,
      ],
    };
  }
}
