import { tenantIdSchema, type SpanId, type TraceId } from '@ariadne/protocol';
import type { TopologySpanRow, TraceReader } from '@ariadne/storage';
import { loadApiConfig } from '../config/api-config';
import { TopologyService } from './topology.service';

const tenant = tenantIdSchema.parse('acme');

function row(n: number, parent: number | null, serviceName: string): TopologySpanRow {
  return {
    traceId: 'a'.repeat(32) as TraceId,
    spanId: n.toString(16).padStart(16, '0') as SpanId,
    parentSpanId: parent === null ? null : (parent.toString(16).padStart(16, '0') as SpanId),
    serviceName,
    spanKind: 'CONSUMER',
    transport: 'kafka',
    channel: 'orders.created',
    operationName: 'op',
    startTime: new Date(),
    durationMs: 50,
    status: 'OK',
    error: null,
  };
}

function makeService(rows: TopologySpanRow[], topologyMaxRows: number) {
  const getSpansForTopology = jest.fn(async () => rows);
  const reader = { getSpansForTopology } as unknown as TraceReader;
  const config = {
    ...loadApiConfig({}),
    topologyMaxRows,
  };
  return { service: new TopologyService(reader, config), getSpansForTopology };
}

describe('TopologyService', () => {
  it('builds the service graph from the window rows', async () => {
    const { service, getSpansForTopology } = makeService(
      [row(1, null, 'order'), row(2, 1, 'inventory')],
      100
    );
    const topology = await service.topology(tenant, {});
    expect(topology.nodes.map((n) => n.service)).toEqual(['inventory', 'order']);
    expect(topology.edges).toHaveLength(1);
    expect(topology.truncated).toBe(false);
    expect(getSpansForTopology).toHaveBeenCalledWith(
      tenant,
      expect.objectContaining({ maxRows: 100 })
    );
  });

  it('flags truncation when the row cap is exceeded', async () => {
    const { service } = makeService([row(1, null, 'a'), row(2, 1, 'b'), row(3, 2, 'c')], 2);
    const topology = await service.topology(tenant, {});
    expect(topology.truncated).toBe(true);
    // Only the capped rows contribute.
    expect(topology.nodes).toHaveLength(2);
  });
});
