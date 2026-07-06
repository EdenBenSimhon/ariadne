import type { Envelope } from '@ariadne/protocol';
import {
  BaseTransport,
  CapabilityError,
  RequestTimeoutError,
  TransportWiringError,
  type Capabilities,
  type Handler,
  type RequestOptions,
  type Subscription,
  type TransportRuntime,
} from '@ariadne/transport-core';
import { DEFAULT_TIMEOUT_MS, type RestTransportConfig } from './rest-config';

/**
 * REST adapter (spec §7): request/reply is HTTP's native mode. Trace headers
 * ride as plain HTTP headers on the outgoing request; the reply's headers and
 * body come back as an Envelope.
 *
 * Pub/sub is declared 'none' for MVP — the spec's outbox/webhook emulation is
 * deferred. `assertCapabilities` at wiring time protects users: a service that
 * requires pubsub fails loudly at construction, never mid-flight. Uses Node
 * 22's global fetch — no HTTP client dependency.
 */
export class RestTransport extends BaseTransport {
  override readonly name = 'rest';
  override readonly caps: Capabilities = { pubsub: 'none', reqreply: 'native' };
  protected override readonly transportKind = 'rest';

  private readonly defaultTimeoutMs: number;

  constructor(
    runtime: TransportRuntime,
    private readonly config: RestTransportConfig = {}
  ) {
    super(runtime);
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  override async connect(): Promise<void> {
    // HTTP is connectionless from the adapter's point of view — nothing to open.
  }

  override async close(): Promise<void> {
    // Nothing to release.
  }

  protected override doPublish(envelope: Envelope): Promise<void> {
    throw new CapabilityError(
      `RestTransport cannot publish to '${envelope.channel}': pubsub is 'none' for the REST ` +
        'adapter (MVP). Use request(), or a broker-backed transport for fire-and-forget events.'
    );
  }

  protected override doSubscribe(pattern: string, handler: Handler): Subscription {
    void handler;
    throw new CapabilityError(
      `RestTransport cannot subscribe to '${pattern}': pubsub is 'none' for the REST adapter ` +
        '(MVP). Expose an HTTP endpoint in your framework instead, or use a broker-backed transport.'
    );
  }

  protected override async doRequest(
    target: string,
    envelope: Envelope,
    opts?: RequestOptions
  ): Promise<Envelope> {
    const url = this.resolveUrl(target);
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.config.headers,
          // Trace headers last — static extras must never mask propagation.
          ...envelope.headers,
        },
        body: JSON.stringify(envelope.payload ?? null),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isAbortLike(err)) throw new RequestTimeoutError(target, timeoutMs);
      throw err;
    }
    if (!response.ok) {
      // Non-2xx is a failed operation — BaseTransport records the ERROR span.
      throw new Error(`request to '${target}' failed with HTTP ${response.status}`);
    }
    return {
      channel: target,
      headers: lowercaseResponseHeaders(response.headers),
      payload: await parseBody(response),
    };
  }

  private resolveUrl(target: string): string {
    try {
      return new URL(target, this.config.baseUrl).toString();
    } catch {
      throw new TransportWiringError(
        `cannot resolve request target '${target}': provide an absolute URL or configure baseUrl`
      );
    }
  }
}

/**
 * AbortSignal.timeout aborts with a DOMException named TimeoutError
 * (AbortError on manual abort). Checked structurally, not by instanceof:
 * DOMException may come from another realm (e.g. jest's VM context).
 */
function isAbortLike(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('name' in err)) return false;
  const name = (err as { name: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function lowercaseResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
