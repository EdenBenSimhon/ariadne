import {
  LIMITS,
  type Metadata,
  type SpanEvent,
  type SpanKind,
  type SpanStatus,
  type TraceContext,
  type TransportKind,
} from '@ariadne/protocol';
import type { Clock } from '../ports/clock';

export interface SpanRecorderInit {
  readonly ctx: TraceContext;
  readonly spanKind: SpanKind;
  readonly transport: TransportKind;
  readonly channel: string;
  readonly operationName: string;
  readonly metadata: Metadata | null;
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return message.length > LIMITS.ERROR_MAX_LEN ? message.slice(0, LIMITS.ERROR_MAX_LEN) : message;
}

/** Records one operation's timing and outcome, then materializes the SpanEvent. */
export class SpanRecorder {
  private status: SpanStatus = 'OK';
  private errorMessage: string | null = null;
  private readonly startIso: string;
  private readonly startMono: number;
  private endMono: number | null = null;

  constructor(
    private readonly init: SpanRecorderInit,
    private readonly clock: Clock
  ) {
    this.startIso = clock.nowIso();
    this.startMono = clock.monotonicMs();
  }

  ok(): void {
    this.finish();
  }

  error(err: unknown): void {
    this.status = 'ERROR';
    this.errorMessage = describeError(err);
    this.finish();
  }

  private finish(): void {
    if (this.endMono === null) this.endMono = this.clock.monotonicMs();
  }

  toEvent(): SpanEvent {
    this.finish();
    const elapsed = Math.max(0, Math.round((this.endMono ?? this.startMono) - this.startMono));
    return {
      traceId: this.init.ctx.traceId,
      spanId: this.init.ctx.spanId,
      parentSpanId: this.init.ctx.parentSpanId,
      tenantId: this.init.ctx.tenantId,
      serviceName: this.init.ctx.serviceName,
      spanKind: this.init.spanKind,
      transport: this.init.transport,
      channel: this.init.channel,
      operationName: this.init.operationName,
      startTime: this.startIso,
      durationMs: Math.min(elapsed, LIMITS.DURATION_MAX_MS),
      status: this.status,
      error: this.errorMessage,
      metadata: this.init.metadata,
    };
  }
}
