import type { Envelope } from '@ariadne/protocol';
import { BaseTransport, type TransportRuntime } from '../lib/base-transport';
import type { Capabilities } from '../lib/capabilities';
import { CapabilityError } from '../lib/errors';
import type { Handler, Subscription } from '../lib/transport';

/**
 * A synchronous in-process bus shared by FakeTransport instances — lets tests
 * run a multi-"service" mesh (publish in service A triggers the subscribed
 * handler in service B) without any broker.
 */
export class InMemoryBus {
  private readonly subscribers = new Map<string, Set<Handler>>();

  register(channel: string, handler: Handler): void {
    const handlers = this.subscribers.get(channel) ?? new Set<Handler>();
    handlers.add(handler);
    this.subscribers.set(channel, handlers);
  }

  unregister(channel: string, handler: Handler): void {
    this.subscribers.get(channel)?.delete(handler);
  }

  async deliver(envelope: Envelope): Promise<void> {
    const handlers = this.subscribers.get(envelope.channel);
    if (!handlers) return;
    for (const handler of handlers) {
      await handler(envelope);
    }
  }
}

/** Broker-less transport for tests. Uses 'kafka' as its declared kind since the protocol enumerates real transports only. */
export class FakeTransport extends BaseTransport {
  override readonly name = 'fake';
  override readonly caps: Capabilities = { pubsub: 'native', reqreply: 'none' };
  protected override readonly transportKind = 'kafka';

  constructor(
    runtime: TransportRuntime,
    private readonly bus: InMemoryBus
  ) {
    super(runtime);
  }

  override async connect(): Promise<void> {
    // in-memory — nothing to connect
  }

  override async close(): Promise<void> {
    // in-memory — nothing to close
  }

  protected override async doPublish(envelope: Envelope): Promise<void> {
    await this.bus.deliver(envelope);
  }

  protected override doSubscribe(pattern: string, handler: Handler): Subscription {
    this.bus.register(pattern, handler);
    return {
      unsubscribe: async () => this.bus.unregister(pattern, handler),
    };
  }

  protected override doRequest(): Promise<Envelope> {
    throw new CapabilityError("FakeTransport declares reqreply: 'none'");
  }
}
