import type { Envelope } from '@ariadne/protocol';
import type { Capabilities } from './capabilities';

/** Transport-specific delivery details, when the broker provides them. */
export interface DeliveryInfo {
  readonly partition?: number;
  readonly offset?: string;
}

export interface InboundEnvelope extends Envelope {
  readonly delivery?: DeliveryInfo;
}

export type Handler = (envelope: InboundEnvelope) => Promise<unknown> | unknown;

export interface Subscription {
  unsubscribe(): Promise<void>;
}

export interface RequestOptions {
  readonly timeoutMs?: number;
}

/**
 * The PORT business code depends on, via DI (spec §4). Tracing is invisible
 * behind it: BaseTransport injects headers and emits spans around every call.
 */
export interface Transport {
  readonly name: string;
  readonly caps: Capabilities;
  connect(): Promise<void>;
  close(): Promise<void>;
  publish(envelope: Envelope): Promise<void>;
  subscribe(pattern: string, handler: Handler): Subscription;
  request(target: string, envelope: Envelope, opts?: RequestOptions): Promise<Envelope>;
}
