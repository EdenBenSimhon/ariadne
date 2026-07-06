import type { TraceContext } from '@ariadne/protocol';
import type { EmitterStats, TransportRuntime } from '@ariadne/transport-core';
import { Inject, Injectable } from '@nestjs/common';
import { EVENT_TRACER_RUNTIME } from './tokens';

/**
 * Optional read-only facade. Nothing requires it — it exists for services
 * that want to log their current trace id or observe emitter health.
 */
@Injectable()
export class EventTracerService {
  constructor(@Inject(EVENT_TRACER_RUNTIME) private readonly runtime: TransportRuntime) {}

  currentContext(): TraceContext | null {
    return this.runtime.context.get();
  }

  get emitterStats(): Readonly<EmitterStats> {
    return this.runtime.emitter.stats;
  }
}
