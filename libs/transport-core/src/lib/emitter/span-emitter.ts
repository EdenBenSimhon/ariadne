import type { SpanEvent } from '@ariadne/protocol';

export interface EmitterStats {
  enqueued: number;
  sent: number;
  droppedBufferFull: number;
  droppedSendFailure: number;
  sendFailures: number;
}

/**
 * Fail-safe span emission port (spec §4, non-negotiable): `emit` is
 * synchronous, O(1) and never throws — business logic must never block, slow
 * or crash because of tracing.
 */
export interface SpanEmitter {
  emit(span: SpanEvent): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  readonly stats: Readonly<EmitterStats>;
}

export function zeroStats(): EmitterStats {
  return { enqueued: 0, sent: 0, droppedBufferFull: 0, droppedSendFailure: 0, sendFailures: 0 };
}
