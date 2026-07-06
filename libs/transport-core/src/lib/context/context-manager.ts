import type { TraceContext } from '@ariadne/protocol';

/**
 * Trace-context propagation port. The default Node implementation uses
 * AsyncLocalStorage (see als-context-manager.ts); other runtimes/SDKs plug in
 * their native mechanism (contextvars, ThreadLocal, ...).
 */
export interface ContextManager {
  get(): TraceContext | null;
  run<T>(ctx: TraceContext, fn: () => T): T;
}

/** No propagation — every operation starts a new root trace. Test/edge use only. */
export class NoopContextManager implements ContextManager {
  get(): TraceContext | null {
    return null;
  }

  run<T>(_ctx: TraceContext, fn: () => T): T {
    return fn();
  }
}
