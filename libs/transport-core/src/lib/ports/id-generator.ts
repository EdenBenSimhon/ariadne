import {
  newCorrelationId,
  newSpanId,
  newTraceId,
  type SpanId,
  type TraceId,
} from '@ariadne/protocol';

/** Injected so tests can use deterministic sequential ids. */
export interface IdGenerator {
  newTraceId(): TraceId;
  newSpanId(): SpanId;
  newCorrelationId(): string;
}

export class DefaultIdGenerator implements IdGenerator {
  newTraceId(): TraceId {
    return newTraceId();
  }

  newSpanId(): SpanId {
    return newSpanId();
  }

  newCorrelationId(): string {
    return newCorrelationId();
  }
}
