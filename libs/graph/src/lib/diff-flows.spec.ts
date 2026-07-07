import type { TraceId } from '@ariadne/protocol';
import { diffBusinessFlows } from './diff-flows';
import type { BusinessFlow } from './flow-signature';

const exampleTraceId = 'a'.repeat(32) as TraceId;

function flow(partial: Partial<BusinessFlow> & { signature: string }): BusinessFlow {
  return {
    services: ['order', 'payment'],
    traceCount: 10,
    errorCount: 0,
    errorRate: 0,
    avgDurationMs: 100,
    exampleTraceId,
    ...partial,
  };
}

describe('diffBusinessFlows', () => {
  it('reports flows that only exist in one window as added/removed', () => {
    const base = [flow({ signature: 'order -[orders.created]-> inventory' })];
    const head = [flow({ signature: 'order -[orders.created]-> payment' })];

    const diff = diffBusinessFlows(base, head);

    expect(diff.changes.map((c) => c.kind).sort()).toEqual(['added', 'removed']);
    const removed = diff.changes.find((c) => c.kind === 'removed');
    expect(removed?.signature).toBe('order -[orders.created]-> inventory');
    expect(removed?.head).toBeNull();
    const added = diff.changes.find((c) => c.kind === 'added');
    expect(added?.base).toBeNull();
    expect(diff.unchangedCount).toBe(0);
  });

  it('flags an error-rate move beyond the threshold as changed', () => {
    const base = [flow({ signature: 'checkout', errorRate: 0.02 })];
    const head = [flow({ signature: 'checkout', errorRate: 0.4, errorCount: 4 })];

    const diff = diffBusinessFlows(base, head);

    expect(diff.changes).toHaveLength(1);
    const change = diff.changes[0];
    expect(change?.kind).toBe('changed');
    expect(change?.errorRateDelta).toBeCloseTo(0.38);
    expect(change?.reasons.join(' ')).toContain('error rate');
  });

  it('flags a latency move beyond the ratio threshold', () => {
    const base = [flow({ signature: 'checkout', avgDurationMs: 100 })];
    const head = [flow({ signature: 'checkout', avgDurationMs: 400 })];

    const diff = diffBusinessFlows(base, head);

    expect(diff.changes[0]?.kind).toBe('changed');
    expect(diff.changes[0]?.avgDurationDeltaMs).toBe(300);
  });

  it('counts stable flows as unchanged and stays quiet about them', () => {
    const base = [flow({ signature: 'checkout' }), flow({ signature: 'refund' })];
    const head = [flow({ signature: 'checkout' }), flow({ signature: 'refund' })];

    const diff = diffBusinessFlows(base, head);

    expect(diff.changes).toHaveLength(0);
    expect(diff.unchangedCount).toBe(2);
  });

  it('orders removed before added before changed (severity)', () => {
    const base = [
      flow({ signature: 'gone' }),
      flow({ signature: 'slower', avgDurationMs: 100 }),
    ];
    const head = [
      flow({ signature: 'new' }),
      flow({ signature: 'slower', avgDurationMs: 900 }),
    ];

    const diff = diffBusinessFlows(base, head);

    expect(diff.changes.map((c) => c.kind)).toEqual(['removed', 'added', 'changed']);
  });
});
