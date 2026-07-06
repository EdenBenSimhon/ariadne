import { parseSpanEvent, type SpanEvent } from '@ariadne/protocol';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import type { StorageDb } from './db';
import { PgTraceStore } from './pg-trace-store';
import type { AggregateSpan } from './trace-aggregate';

let seq = 0;
function event(overrides: Partial<Record<string, unknown>> = {}): SpanEvent {
  seq += 1;
  const result = parseSpanEvent({
    traceId: 'f'.repeat(32),
    spanId: seq.toString(16).padStart(16, '0'),
    parentSpanId: null,
    tenantId: 'acme',
    serviceName: 'order-service',
    spanKind: 'PRODUCER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: 'publish orders.created',
    startTime: '2026-07-06T10:00:00.050Z',
    durationMs: 70,
    status: 'OK',
    error: null,
    metadata: null,
    ...overrides,
  });
  if (!result.success) throw new Error(`fixture invalid: ${result.error.message}`);
  return result.data;
}

interface CapturedTx {
  spanValues: unknown[][];
  spanConflicts: unknown[];
  traceValues: unknown[][];
  traceConflicts: Array<{ target: unknown; set: Record<string, unknown> }>;
}

function makeDb(returnedRows: AggregateSpan[]): { db: StorageDb; captured: CapturedTx } {
  const captured: CapturedTx = {
    spanValues: [],
    spanConflicts: [],
    traceValues: [],
    traceConflicts: [],
  };

  const spansChain = {
    values(rows: unknown[]) {
      captured.spanValues.push(rows);
      return this;
    },
    onConflictDoNothing(opts: unknown) {
      captured.spanConflicts.push(opts);
      return this;
    },
    returning: () => Promise.resolve(returnedRows),
  };
  const tracesChain = {
    values(rows: unknown[]) {
      captured.traceValues.push(rows);
      return this;
    },
    onConflictDoUpdate(opts: { target: unknown; set: Record<string, unknown> }) {
      captured.traceConflicts.push(opts);
      return Promise.resolve([]);
    },
  };

  let insertCall = 0;
  const tx = {
    insert: () => {
      insertCall += 1;
      return insertCall === 1 ? spansChain : tracesChain;
    },
  };
  const db = {
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as StorageDb;
  return { db, captured };
}

function inserted(e: SpanEvent): AggregateSpan {
  return {
    tenantId: e.tenantId,
    traceId: e.traceId,
    parentSpanId: e.parentSpanId,
    serviceName: e.serviceName,
    startTime: new Date(e.startTime),
    durationMs: e.durationMs,
    status: e.status,
  };
}

const pool = { end: jest.fn() } as unknown as Pool;

describe('PgTraceStore.insertSpans', () => {
  it('writes all spans in one multi-row statement, sorted for stable lock order', async () => {
    const events = [
      event({ spanId: 'f'.repeat(16) }),
      event({ spanId: '1'.repeat(16) }),
      event({ spanId: 'a'.repeat(16) }),
    ];
    const { db, captured } = makeDb(events.map(inserted));
    const store = new PgTraceStore(db, pool);

    const result = await store.insertSpans(events);

    expect(captured.spanValues).toHaveLength(1);
    const rows = captured.spanValues[0] as Array<{ spanId: string }>;
    expect(rows.map((r) => r.spanId)).toEqual([
      '1'.repeat(16),
      'a'.repeat(16),
      'f'.repeat(16),
    ]);
    expect(result).toEqual({ received: 3, inserted: 3, duplicates: 0 });
  });

  it('computes the traces delta ONLY from actually-inserted rows (replay safety)', async () => {
    const events = [event(), event(), event(), event()];
    // Simulate at-least-once redelivery: DB reports just one row as new.
    const { db, captured } = makeDb([inserted(events[0]!)]);
    const store = new PgTraceStore(db, pool);

    const result = await store.insertSpans(events);

    expect(result).toEqual({ received: 4, inserted: 1, duplicates: 3 });
    const aggregateRows = captured.traceValues[0] as Array<{ spanCount: number }>;
    expect(aggregateRows).toHaveLength(1);
    expect(aggregateRows[0]?.spanCount).toBe(1);
  });

  it('skips the traces upsert entirely when every span was a duplicate', async () => {
    const { db, captured } = makeDb([]);
    const store = new PgTraceStore(db, pool);

    const result = await store.insertSpans([event(), event()]);

    expect(result).toEqual({ received: 2, inserted: 0, duplicates: 2 });
    expect(captured.traceValues).toHaveLength(0);
  });

  it('does not open a transaction for an empty batch', async () => {
    const transaction = jest.fn();
    const db = { transaction } as unknown as StorageDb;
    const store = new PgTraceStore(db, pool);

    await expect(store.insertSpans([])).resolves.toEqual({
      received: 0,
      inserted: 0,
      duplicates: 0,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('merges the aggregate with commutative SQL (COALESCE / + / LEAST / GREATEST / OR)', async () => {
    const events = [event()];
    const { db, captured } = makeDb(events.map(inserted));
    const store = new PgTraceStore(db, pool);
    await store.insertSpans(events);

    const conflict = captured.traceConflicts[0];
    expect(conflict).toBeDefined();
    const dialect = new PgDialect();
    const render = (fragment: unknown): string => dialect.sqlToQuery(fragment as SQL).sql;

    expect(render(conflict?.set['rootService'])).toMatch(/COALESCE\(.*root_service.*excluded\.root_service\)/i);
    expect(render(conflict?.set['spanCount'])).toMatch(/span_count.*\+.*excluded\.span_count/i);
    expect(render(conflict?.set['startTime'])).toMatch(/LEAST\(.*start_time.*excluded\.start_time\)/i);
    expect(render(conflict?.set['endTime'])).toMatch(/GREATEST\(.*end_time.*excluded\.end_time\)/i);
    expect(render(conflict?.set['hasError'])).toMatch(/has_error.*OR.*excluded\.has_error/i);
  });
});
