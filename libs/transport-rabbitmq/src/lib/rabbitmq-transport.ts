import { DLQ_SUFFIX, HEADERS, type Envelope } from '@ariadne/protocol';
import {
  BaseTransport,
  TransportWiringError,
  type Capabilities,
  type Handler,
  type InboundEnvelope,
  type RequestOptions,
  type Subscription,
  type TransportRuntime,
} from '@ariadne/transport-core';
import { connect, type Channel, type ChannelModel, type ConsumeMessage } from 'amqplib';
import { decodeHeaders, encodeHeaders } from './header-codec';
import {
  DEFAULT_EXCHANGE,
  DEFAULT_PREFETCH,
  DLX_SUFFIX,
  type RabbitMqTransportConfig,
} from './rabbitmq-config';
import { ReplyRegistry } from './reply-registry';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function parsePayload(content: Buffer): unknown {
  const text = content.toString('utf8');
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function encodePayload(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload ?? null), 'utf8');
}

/**
 * RabbitMQ adapter (spec §7). Envelope headers ride AMQP `properties.headers`;
 * both pub/sub (topic exchange + bound queues) and request/reply (exclusive
 * reply queue + correlationId — the AMQP direct reply-to pattern) are native.
 *
 * Channel layout: ONE connection, TWO channels — a publish channel and a
 * consume channel. amqplib channels are not safe for interleaved use and a
 * channel-level error (e.g. a failed publish) kills the channel; splitting
 * publish from consume keeps a poison publish from tearing down consumers.
 * Confirm channels are deliberately not used for MVP — persistent delivery
 * plus consumer acks cover the durability story.
 *
 * Poison-message policy: `nack(msg, false, false)` (no requeue). Every app
 * queue is asserted with `x-dead-letter-exchange: <exchange>.dlx` (a fanout
 * exchange asserted at connect with a `<exchange>.dlq` queue bound to it), so
 * a nacked message is dead-lettered by the broker instead of redelivering
 * forever — the spec's "ack/nack with a Dead-Letter-Exchange".
 *
 * At-least-once note: spanIds are generated once per operation in
 * BaseTransport before any send, so a broker redelivery re-emits the SAME
 * spanId — the collector's idempotent upsert by (tenantId, spanId) absorbs
 * duplicates. Never regenerate a spanId on retry.
 */
export class RabbitMqTransport extends BaseTransport {
  override readonly name = 'rabbitmq';
  override readonly caps: Capabilities = { pubsub: 'native', reqreply: 'native' };
  protected override readonly transportKind = 'rabbitmq';

  private connection: ChannelModel | null = null;
  private publishChannel: Channel | null = null;
  private consumeChannel: Channel | null = null;
  private readonly registrations = new Map<string, Handler>();
  private readonly replies = new ReplyRegistry();
  private replyQueue: string | null = null;
  /**
   * Routing keys that are reply destinations (server-named queues, only
   * routable on the DEFAULT exchange ''). maybeReply registers the key just
   * before publishing so doPublish — which the tracing wrapper drives — knows
   * to bypass the topic exchange while still emitting the PRODUCER span.
   */
  private readonly pendingReplyRoutes = new Set<string>();
  private readonly exchange: string;
  private readonly dlxExchange: string;
  private readonly queuePrefix: string;
  private readonly prefetchCount: number;
  private readonly defaultRequestTimeoutMs: number;
  private connected = false;

  constructor(
    runtime: TransportRuntime,
    private readonly config: RabbitMqTransportConfig
  ) {
    super(runtime);
    this.exchange = config.exchange ?? DEFAULT_EXCHANGE;
    this.dlxExchange = `${this.exchange}${DLX_SUFFIX}`;
    this.queuePrefix = config.queuePrefix ?? `svc.${runtime.serviceName}`;
    this.prefetchCount = config.prefetch ?? DEFAULT_PREFETCH;
    this.defaultRequestTimeoutMs = config.requestReply?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  override async connect(): Promise<void> {
    if (this.connected) return;
    this.connection = await connect(this.config.url);
    this.publishChannel = await this.connection.createChannel();
    this.consumeChannel = await this.connection.createChannel();

    // App exchange + its dead-letter pair (see class doc).
    await this.publishChannel.assertExchange(this.exchange, 'topic', { durable: true });
    await this.publishChannel.assertExchange(this.dlxExchange, 'fanout', { durable: true });
    const dlq = `${this.exchange}${DLQ_SUFFIX}`;
    await this.publishChannel.assertQueue(dlq, { durable: true });
    await this.publishChannel.bindQueue(dlq, this.dlxExchange, '');

    if (this.registrations.size > 0) {
      await this.consumeChannel.prefetch(this.prefetchCount);
      for (const [pattern, handler] of this.registrations) {
        const queue = `${this.queuePrefix}.${pattern}`;
        await this.consumeChannel.assertQueue(queue, {
          durable: true,
          arguments: { 'x-dead-letter-exchange': this.dlxExchange },
        });
        await this.consumeChannel.bindQueue(queue, this.exchange, pattern);
        await this.consumeChannel.consume(
          queue,
          (msg) => void this.dispatch(pattern, handler, msg),
          { noAck: false }
        );
      }
    }
    this.connected = true;
  }

  override async close(): Promise<void> {
    this.replies.rejectAll(new TransportWiringError('rabbitmq transport closed'));
    this.replyQueue = null;
    if (this.consumeChannel) {
      await this.consumeChannel.close().catch(() => undefined);
      this.consumeChannel = null;
    }
    if (this.publishChannel) {
      await this.publishChannel.close().catch(() => undefined);
      this.publishChannel = null;
    }
    if (this.connection) {
      await this.connection.close().catch(() => undefined);
      this.connection = null;
    }
    this.connected = false;
  }

  protected override async doPublish(envelope: Envelope): Promise<void> {
    const channel = this.requirePublishChannel();
    const isReply = this.pendingReplyRoutes.has(envelope.channel);
    const correlationId = envelope.headers[HEADERS.CORRELATION_ID];
    channel.publish(
      // Replies go to the default exchange '' — it routes straight to the
      // queue named by the routing key; server-named reply queues are not
      // bound to the topic exchange.
      isReply ? '' : this.exchange,
      envelope.channel,
      encodePayload(envelope.payload),
      {
        headers: encodeHeaders(envelope.headers),
        persistent: true,
        // AMQP convention: replies carry properties.correlationId too.
        ...(isReply && correlationId !== undefined ? { correlationId } : {}),
      }
    );
  }

  protected override doSubscribe(pattern: string, handler: Handler): Subscription {
    if (this.connected) {
      // Queues and consumers are wired once, in connect() — fail loudly at wiring time.
      throw new TransportWiringError(
        `cannot subscribe to '${pattern}' after connect(); register all subscriptions before connecting`
      );
    }
    if (this.registrations.has(pattern)) {
      throw new TransportWiringError(`already subscribed to '${pattern}'`);
    }
    this.registrations.set(pattern, handler);
    return {
      unsubscribe: async () => {
        this.registrations.delete(pattern);
      },
    };
  }

  protected override async doRequest(
    target: string,
    envelope: Envelope,
    opts?: RequestOptions
  ): Promise<Envelope> {
    const correlationId = envelope.headers[HEADERS.CORRELATION_ID];
    if (correlationId === undefined) {
      throw new TransportWiringError('request envelope is missing its correlation id header');
    }
    const replyQueue = await this.ensureReplyConsumer();
    const timeoutMs = opts?.timeoutMs ?? this.defaultRequestTimeoutMs;
    const pendingReply = this.replies.register(correlationId, target, timeoutMs);
    const channel = this.requirePublishChannel();
    channel.publish(this.exchange, target, encodePayload(envelope.payload), {
      headers: encodeHeaders(envelope.headers),
      persistent: true,
      correlationId,
      replyTo: replyQueue,
    });
    return pendingReply;
  }

  private async dispatch(
    pattern: string,
    handler: Handler,
    msg: ConsumeMessage | null
  ): Promise<void> {
    // null = the broker cancelled this consumer (queue deleted, connection torn down).
    if (msg === null) return;
    const channel = this.consumeChannel;
    if (channel === null) return;
    const headers = decodeHeaders(msg.properties.headers);
    const inbound: InboundEnvelope = {
      channel: msg.fields.routingKey || pattern,
      headers,
      payload: parsePayload(msg.content),
    };
    try {
      // The CONSUMER span (including the error case) is recorded by BaseTransport's wrapper.
      const result = await handler(inbound);
      await this.maybeReply(msg, headers, result);
      channel.ack(msg);
    } catch {
      // No requeue: the broker dead-letters the message via the queue's DLX (see class doc).
      channel.nack(msg, false, false);
    }
  }

  /** Responder side of native request/reply: route the handler's return value back. */
  private async maybeReply(
    msg: ConsumeMessage,
    headers: Record<string, string>,
    result: unknown
  ): Promise<void> {
    const replyTo = typeof msg.properties.replyTo === 'string' ? msg.properties.replyTo : undefined;
    const rawCorrelationId = msg.properties.correlationId;
    const correlationId =
      typeof rawCorrelationId === 'string' ? rawCorrelationId : headers[HEADERS.CORRELATION_ID];
    if (replyTo === undefined || correlationId === undefined || result === undefined) return;
    this.pendingReplyRoutes.add(replyTo);
    try {
      // Through publish() so the reply gets its own PRODUCER span.
      await this.publish({
        channel: replyTo,
        headers: { [HEADERS.CORRELATION_ID]: correlationId },
        payload: result,
      });
    } finally {
      this.pendingReplyRoutes.delete(replyTo);
    }
  }

  /**
   * Lazily create the per-instance exclusive reply queue (native RPC). The
   * server names it (`assertQueue('')`); replies are consumed with noAck —
   * a lost reply surfaces as a RequestTimeoutError, never a stuck unacked
   * message on an exclusive queue.
   */
  private async ensureReplyConsumer(): Promise<string> {
    if (this.replyQueue !== null) return this.replyQueue;
    const channel = this.consumeChannel;
    if (channel === null) {
      throw new TransportWiringError('cannot request before connect()');
    }
    const { queue } = await channel.assertQueue('', { exclusive: true });
    await channel.consume(
      queue,
      (msg) => {
        if (msg === null) return;
        const headers = decodeHeaders(msg.properties.headers);
        const rawCorrelationId = msg.properties.correlationId;
        const correlationId =
          typeof rawCorrelationId === 'string'
            ? rawCorrelationId
            : headers[HEADERS.CORRELATION_ID];
        if (correlationId === undefined) return;
        this.replies.resolve(correlationId, {
          channel: queue,
          headers,
          payload: parsePayload(msg.content),
        });
      },
      { noAck: true }
    );
    this.replyQueue = queue;
    return queue;
  }

  private requirePublishChannel(): Channel {
    if (this.publishChannel === null) {
      throw new TransportWiringError('cannot publish before connect()');
    }
    return this.publishChannel;
  }
}
