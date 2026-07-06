import { buildTraceDag } from './build-trace-dag';
import { computeFlowSignature, discoverBusinessFlows } from './flow-signature';
import { span, TRACE_A, TRACE_B } from './test-fixtures';

const orderFlow = (errored = false) => [
  span(1, null, { serviceName: 'order' }),
  span(2, 1, { serviceName: 'inventory', channel: 'orders.created' }),
  span(3, 2, {
    serviceName: 'payment',
    channel: 'inventory.reserved',
    ...(errored ? { status: 'ERROR' as const, error: 'boom' } : {}),
  }),
];

describe('computeFlowSignature', () => {
  it('captures ordered cross-service hops with channels', () => {
    const dag = buildTraceDag(TRACE_A, orderFlow());
    expect(computeFlowSignature(dag)).toBe(
      'order -[orders.created]-> inventory | inventory -[inventory.reserved]-> payment'
    );
  });

  it('ignores same-service hops and never leaks span ids or timings', () => {
    const dag = buildTraceDag(TRACE_A, [
      span(1, null, { serviceName: 'order' }),
      span(2, 1, { serviceName: 'order' }),
    ]);
    const signature = computeFlowSignature(dag);
    expect(signature).toBe('order (internal)');
    expect(signature).not.toMatch(/[0-9a-f]{16}/);
  });

  it('is identical for structurally equal traces regardless of ids/timing', () => {
    const a = buildTraceDag(TRACE_A, orderFlow());
    const b = buildTraceDag(
      TRACE_B,
      orderFlow().map((s) => ({ ...s, startTimeMs: s.startTimeMs + 999, durationMs: 5 }))
    );
    expect(computeFlowSignature(a)).toBe(computeFlowSignature(b));
  });
});

describe('discoverBusinessFlows', () => {
  it('clusters traces by signature with counts, error rate and avg duration', () => {
    const flows = discoverBusinessFlows([
      { traceId: TRACE_A, durationMs: 100, hasError: false, dag: buildTraceDag(TRACE_A, orderFlow()) },
      { traceId: TRACE_B, durationMs: 300, hasError: true, dag: buildTraceDag(TRACE_B, orderFlow(true)) },
    ]);
    expect(flows).toHaveLength(1);
    const flow = flows[0];
    expect(flow?.traceCount).toBe(2);
    expect(flow?.errorRate).toBe(0.5);
    expect(flow?.avgDurationMs).toBe(200);
    expect(flow?.services).toEqual(['inventory', 'order', 'payment']);
    expect(flow?.exampleTraceId).toBe(TRACE_A);
  });

  it('sorts distinct flows by frequency', () => {
    const single = [span(1, null, { serviceName: 'cron' })];
    const flows = discoverBusinessFlows([
      { traceId: TRACE_A, durationMs: 10, hasError: false, dag: buildTraceDag(TRACE_A, single) },
      { traceId: TRACE_A, durationMs: 10, hasError: false, dag: buildTraceDag(TRACE_A, orderFlow()) },
      { traceId: TRACE_B, durationMs: 10, hasError: false, dag: buildTraceDag(TRACE_B, orderFlow()) },
    ]);
    expect(flows).toHaveLength(2);
    expect(flows[0]?.traceCount).toBe(2);
    expect(flows[1]?.signature).toBe('cron (internal)');
  });

  it('handles empty input', () => {
    expect(discoverBusinessFlows([])).toEqual([]);
  });
});
