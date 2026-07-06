import { tenantIdSchema, type SpanId, type TraceId } from '@ariadne/protocol';
import type { StoredSpan, StoredTrace, TraceReader } from '@ariadne/storage';
import type { TopologyService } from '../topology/topology.service';
import { FlowsService } from './flows.service';

const tenant = tenantIdSchema.parse('acme');
const tid = (n: number): TraceId => n.toString(16).padStart(32, '0') as TraceId;

function traceRow(n: number, hasError: boolean): StoredTrace {
  return {
    tenantId: tenant,
    traceId: tid(n),
    rootService: 'order',
    spanCount: 2,
    startTime: new Date(1_750_000_000_000),
    endTime: new Date(1_750_000_000_400),
    durationMs: 400,
    hasError,
    updatedAt: new Date(),
  };
}

function spanRow(traceN: number, n: number, parent: number | null, service: string): StoredSpan {
  return {
    tenantId: tenant,
    spanId: `${traceN}${n}`.padStart(16, '0') as SpanId,
    traceId: tid(traceN),
    parentSpanId: parent === null ? null : (`${traceN}${parent}`.padStart(16, '0') as SpanId),
    serviceName: service,
    spanKind: 'CONSUMER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: 'op',
    startTime: new Date(1_750_000_000_000 + n * 100),
    durationMs: 50,
    status: 'OK',
    error: null,
    metadata: null,
    receivedAt: new Date(),
  };
}

function makeService(traces: StoredTrace[], spansByTrace: Record<string, StoredSpan[]>) {
  const reader = {
    listTraces: jest.fn(async () => traces),
    getSpansForTrace: jest.fn(async (_tenant: unknown, traceId: string) => spansByTrace[traceId] ?? []),
  } as unknown as TraceReader;
  const topology = {
    topology: jest.fn(async () => ({ nodes: [], edges: [], cycles: [['order', 'payment']], truncated: false })),
  } as unknown as TopologyService;
  return new FlowsService(reader, topology);
}

describe('FlowsService', () => {
  it('samples trace details and clusters them into flows', async () => {
    const service = makeService([traceRow(1, false), traceRow(2, true)], {
      [tid(1)]: [spanRow(1, 1, null, 'order'), spanRow(1, 2, 1, 'inventory')],
      [tid(2)]: [spanRow(2, 1, null, 'order'), spanRow(2, 2, 1, 'inventory')],
    });

    const result = await service.flows(tenant, { sampleSize: 10 });

    expect(result.sampledTraces).toBe(2);
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0]?.traceCount).toBe(2);
    expect(result.flows[0]?.errorRate).toBe(0.5);
    expect(result.flows[0]?.signature).toContain('order -[orders.created]-> inventory');
  });

  it('combines topology and flows into anomalies (shared with UI + MCP)', async () => {
    const service = makeService([traceRow(1, true), traceRow(2, true)], {
      [tid(1)]: [spanRow(1, 1, null, 'order')],
      [tid(2)]: [spanRow(2, 1, null, 'order')],
    });

    const result = await service.anomalies(tenant, { sampleSize: 10 });

    const kinds = result.anomalies.map((a) => a.kind);
    expect(kinds).toContain('service-cycle');
    expect(kinds).toContain('failing-flow');
  });

  it('handles an empty tenant', async () => {
    const service = makeService([], {});
    const result = await service.flows(tenant, { sampleSize: 10 });
    expect(result).toEqual({ sampledTraces: 0, flows: [] });
  });
});
