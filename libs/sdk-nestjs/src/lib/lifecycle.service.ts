import type { Transport, TransportRuntime } from '@ariadne/transport-core';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { EVENT_TRACER_RUNTIME, EVENT_TRACER_TRANSPORT } from './tokens';

/**
 * Connects the transport once all subscriptions are registered, and on
 * shutdown closes it and flushes the span buffer (best-effort, bounded).
 */
@Injectable()
export class EventTracerLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(EVENT_TRACER_TRANSPORT) private readonly transport: Transport,
    @Inject(EVENT_TRACER_RUNTIME) private readonly runtime: TransportRuntime
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.transport.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.transport.close();
    await this.runtime.emitter.close();
  }
}
