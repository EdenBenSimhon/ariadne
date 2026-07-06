import type { SpanEvent } from '@ariadne/protocol';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { spans } from './schema/spans';

export type SpanRow = InferInsertModel<typeof spans>;
export type StoredSpan = InferSelectModel<typeof spans>;

/** The one place a protocol SpanEvent becomes a DB row (ISO string → Date). */
export function spanEventToRow(event: SpanEvent): SpanRow {
  return {
    tenantId: event.tenantId,
    spanId: event.spanId,
    traceId: event.traceId,
    parentSpanId: event.parentSpanId,
    serviceName: event.serviceName,
    spanKind: event.spanKind,
    transport: event.transport,
    channel: event.channel,
    operationName: event.operationName,
    startTime: new Date(event.startTime),
    durationMs: event.durationMs,
    status: event.status,
    error: event.error,
    metadata: event.metadata,
  };
}
