import { tenantIdSchema, type TraceContext } from '@ariadne/protocol';
import { SequentialIdGenerator } from '../../testing/sequential-ids';
import { AsyncLocalStorageContextManager } from './als-context-manager';

const ids = new SequentialIdGenerator();

function makeCtx(): TraceContext {
  return {
    traceId: ids.newTraceId(),
    spanId: ids.newSpanId(),
    parentSpanId: null,
    tenantId: tenantIdSchema.parse('acme'),
    serviceName: 'svc-test',
    correlationId: null,
  };
}

describe('AsyncLocalStorageContextManager', () => {
  it('returns null outside any run', () => {
    expect(new AsyncLocalStorageContextManager().get()).toBeNull();
  });

  it('exposes the context inside run and survives awaits', async () => {
    const manager = new AsyncLocalStorageContextManager();
    const ctx = makeCtx();
    await manager.run(ctx, async () => {
      expect(manager.get()).toBe(ctx);
      await new Promise((resolve) => setImmediate(resolve));
      expect(manager.get()).toBe(ctx);
    });
    expect(manager.get()).toBeNull();
  });

  it('isolates parallel async flows', async () => {
    const manager = new AsyncLocalStorageContextManager();
    const a = makeCtx();
    const b = makeCtx();
    await Promise.all([
      manager.run(a, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(manager.get()).toBe(a);
      }),
      manager.run(b, async () => {
        expect(manager.get()).toBe(b);
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(manager.get()).toBe(b);
      }),
    ]);
  });
});
