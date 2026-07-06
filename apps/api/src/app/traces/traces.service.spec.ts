import { tenantIdSchema, traceIdSchema, type SpanId, type TraceId } from '@ariadne/protocol';
import type { StoredSpan, StoredTrace, TraceReader } from '@ariadne/storage';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { decodeCursor } from '../common/query';
import { TracesService } from './traces.service';
import type { TracesQuery } from './traces-query';

const tenant = tenantIdSchema.parse('acme');

function trace(n: number, overrides: Partial<StoredTrace> = {}): StoredTrace {
  return {
    tenantId: tenant,
    traceId: (n.toString(16).padStart(32, '0')) as TraceId,
    rootService: 'order-service',
    spanCount: 6,
    startTime: new Date(1_750_000_000_000 + n * 1_000),
    endTime: new Date(1_750_000_000_500 + n * 1_000),
    durationMs: 500,
    hasError: false,
    updatedAt: new Date(),
    ...overrides,
  };
}

function storedSpan(n: number, parent: number | null): StoredSpan {
  return {
    tenantId: tenant,
    spanId: n.toString(16).padStart(16, '0') as SpanId,
    traceId: '1'.padStart(32, '0') as TraceId,
    parentSpanId: parent === null ? null : (parent.toString(16).padStart(16, '0') as SpanId),
    serviceName: `svc-${n}`,
    spanKind: 'CONSUMER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: `op-${n}`,
    startTime: new Date(1_750_000_000_000 + n * 100),
    durationMs: 50,
    status: 'OK',
    error: null,
    metadata: null,
    receivedAt: new Date(),
  };
}

function makeReader(overrides: Partial<TraceReader> = {}): TraceReader {
  return {
    listTraces: jest.fn(async () => []),
    getTrace: jest.fn(async () => null),
    getSpansForTrace: jest.fn(async () => []),
    ...overrides,
  } as unknown as TraceReader;
}

const query = (overrides: Partial<TracesQuery> = {}): TracesQuery => ({
  limit: 2,
  ...overrides,
});

describe('TracesService.list', () => {
  it('derives nextCursor from the limit+1 fetch', async () => {
    const rows = [trace(3), trace(2), trace(1)]; // reader returned limit+1
    const service = new TracesService(makeReader({ listTraces: jest.fn(async () => rows) }));

    const page = await service.list(tenant, query());

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const cursor = decodeCursor(page.nextCursor as string);
    expect(cursor.traceId).toBe(rows[1]?.traceId);
    expect(cursor.startTime).toEqual(rows[1]?.startTime);
  });

  it('returns a null cursor on the last page', async () => {
    const service = new TracesService(
      makeReader({ listTraces: jest.fn(async () => [trace(1)]) })
    );
    const page = await service.list(tenant, query());
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("maps status=error to the hasError filter", async () => {
    const listTraces = jest.fn(async () => []);
    const service = new TracesService(makeReader({ listTraces }));
    await service.list(tenant, query({ status: 'error' }));
    expect(listTraces).toHaveBeenCalledWith(tenant, expect.objectContaining({ hasError: true }));
  });

  it('serializes summaries with ISO timestamps', async () => {
    const service = new TracesService(
      makeReader({ listTraces: jest.fn(async () => [trace(1)]) })
    );
    const page = await service.list(tenant, query());
    expect(page.items[0]?.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(page.items[0]?.durationMs).toBe(500);
  });
});

describe('TracesService.detail', () => {
  it('rejects malformed ids before touching the reader', async () => {
    const getTrace = jest.fn();
    const service = new TracesService(makeReader({ getTrace }));
    await expect(service.detail(tenant, 'not-a-trace-id')).rejects.toThrow(BadRequestException);
    expect(getTrace).not.toHaveBeenCalled();
  });

  it('404s on an unknown trace', async () => {
    const service = new TracesService(makeReader());
    await expect(service.detail(tenant, 'f'.repeat(32))).rejects.toThrow(NotFoundException);
  });

  it('builds the dag and critical path from stored spans', async () => {
    const traceId = traceIdSchema.parse('f'.repeat(32));
    const service = new TracesService(
      makeReader({
        getTrace: jest.fn(async () => trace(1, { traceId })),
        getSpansForTrace: jest.fn(async () => [storedSpan(1, null), storedSpan(2, 1)]),
      })
    );

    const detail = await service.detail(tenant, traceId);

    expect(detail.spans).toHaveLength(2);
    expect(detail.spans[0]?.startTimeMs).toBe(1_750_000_000_100);
    expect(detail.dag.roots).toHaveLength(1);
    expect(detail.dag.nodes[detail.dag.roots[0] as string]?.depth).toBe(0);
    expect(detail.criticalPath.spanIds).toHaveLength(2);
  });
});
