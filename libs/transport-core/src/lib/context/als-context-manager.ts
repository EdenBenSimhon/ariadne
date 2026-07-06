import { AsyncLocalStorage } from 'node:async_hooks';
import type { TraceContext } from '@ariadne/protocol';
import type { ContextManager } from './context-manager';

/**
 * Default Node context manager. Context set around a consumer handler is
 * visible to every downstream publish in the same async execution flow —
 * that is what chains parentSpanId across an entire service hop.
 */
export class AsyncLocalStorageContextManager implements ContextManager {
  private readonly als = new AsyncLocalStorage<TraceContext>();

  get(): TraceContext | null {
    return this.als.getStore() ?? null;
  }

  run<T>(ctx: TraceContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }
}
