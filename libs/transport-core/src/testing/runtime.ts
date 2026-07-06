import { tenantIdSchema } from '@ariadne/protocol';
import type { TransportRuntime } from '../lib/base-transport';
import { AsyncLocalStorageContextManager } from '../lib/context/als-context-manager';
import { CapturingEmitter } from './capturing-emitter';
import { ManualClock } from './manual-clock';
import { SequentialIdGenerator } from './sequential-ids';

/** A fully-faked TransportRuntime; override any piece per test. */
export function makeTestRuntime(overrides: Partial<TransportRuntime> = {}): TransportRuntime {
  return {
    serviceName: 'svc-test',
    tenantId: tenantIdSchema.parse('acme'),
    emitter: new CapturingEmitter(),
    context: new AsyncLocalStorageContextManager(),
    clock: new ManualClock(),
    ids: new SequentialIdGenerator(),
    redactionAllowlist: ['orderId'],
    ...overrides,
  };
}
