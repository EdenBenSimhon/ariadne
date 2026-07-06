import { DLQ_SUFFIX, HEADERS, LIMITS, type Envelope } from '@ariadne/protocol';
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
import { Kafka, type Consumer, type KafkaMessage, type Producer } from 'kafkajs';
import { decodeHeaders, encodeHeaders } from './header-codec';
import {
  DLQ_ERROR_HEADER,
  DLQ_SOURCE_TOPIC_HEADER,
  REPLY_TO_HEADER,
  type KafkaTransportConfig,
} from './kafka-config';
import { ReplyRegistry } from './reply-registry';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function parsePayload(value: Buffer | null): unknown {
  if (value === null) return null;
  const text = value.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return message.slice(0, LIMITS.ERROR_MAX_LEN);
}

/**
 * Kafka adapter (spec §7). Envelope headers ride record.headers; pub/sub is
 * native, request/reply is emulated with a per-instance reply topic +
 * correlationId routing (settled decision).
 *
 * At-least-once note: spanIds are generated once per operation in
 * BaseTransport before any send, so a broker redelivery re-emits the SAME
 * spanId — the collector's idempotent upsert by (tenantId, spanId) absorbs
 * duplicates. Never regenerate a spanId on retry.
 */
export class KafkaTransport extends BaseTransport {
  override readonly name = 'kafka';
  override readonly caps: Capabilities = { pubsub: 'native', reqreply: 'emulated' };
  protected override readonly transportKind = 'kafka';

  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly consumer: Consumer;
  private replyConsumer: Consumer | null = null;
  private readonly registrations = new Map<string, Handler>();
  private readonly replies = new ReplyRegistry();
  private readonly replyTopic: string;
  private readonly dlqEnabled: boolean;
  private readonly defaultRequestTimeoutMs: number;
  private consumerStarted = false;
  private connected = false;

  constructor(
    runtime: TransportRuntime,
    private readonly config: KafkaTransportConfig
  ) {
    super(runtime);
    const clientId = config.clientId ?? runtime.serviceName;
    this.kafka = new Kafka({
      clientId,
      brokers: [...config.brokers],
      ...(config.ssl !== undefined ? { ssl: config.ssl } : {}),
      ...(config.sasl !== undefined ? { sasl: config.sasl } : {}),
    });
    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({
      groupId: config.groupId ?? `svc.${runtime.serviceName}`,
    });
    // Per-instance reply topic (settled decision): unique per process instance.
    this.replyTopic = `${runtime.serviceName}.reply.${runtime.ids.newCorrelationId()}`;
    this.dlqEnabled = config.dlq?.enabled ?? true;
    this.defaultRequestTimeoutMs = config.requestReply?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  override async connect(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    if (this.registrations.size > 0) {
      await this.consumer.connect();
      for (const topic of this.registrations.keys()) {
        await this.consumer.subscribe({ topic });
      }
      await this.consumer.run({
        eachMessage: ({ topic, partition, message }) => this.dispatch(topic, partition, message),
      });
      this.consumerStarted = true;
    }
    this.connected = true;
  }

  override async close(): Promise<void> {
    this.replies.rejectAll(new TransportWiringError('kafka transport closed'));
    if (this.replyConsumer) {
      await this.replyConsumer.disconnect().catch(() => undefined);
      this.replyConsumer = null;
    }
    if (this.consumerStarted) {
      await this.consumer.disconnect().catch(() => undefined);
      this.consumerStarted = false;
    }
    if (this.connected) {
      await this.producer.disconnect().catch(() => undefined);
      this.connected = false;
    }
  }

  protected override async doPublish(envelope: Envelope): Promise<void> {
    await this.producer.send({
      topic: envelope.channel,
      messages: [
        {
          value: JSON.stringify(envelope.payload ?? null),
          headers: encodeHeaders(envelope.headers),
          // Partition key = entity id → per-entity ordering (spec §7).
          ...(envelope.key !== undefined ? { key: envelope.key } : {}),
        },
      ],
    });
  }

  protected override doSubscribe(pattern: string, handler: Handler): Subscription {
    if (this.consumerStarted) {
      // kafkajs cannot add topics after consumer.run() — fail loudly at wiring time.
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
    await this.ensureReplyConsumer();
    const timeoutMs = opts?.timeoutMs ?? this.defaultRequestTimeoutMs;
    const pendingReply = this.replies.register(correlationId, target, timeoutMs);
    await this.doPublish({
      ...envelope,
      channel: target,
      headers: { ...envelope.headers, [REPLY_TO_HEADER]: this.replyTopic },
    });
    return pendingReply;
  }

  private async dispatch(topic: string, partition: number, message: KafkaMessage): Promise<void> {
    const handler = this.registrations.get(topic);
    if (!handler) return;
    const headers = decodeHeaders(message.headers);
    const inbound: InboundEnvelope = {
      channel: topic,
      headers,
      payload: parsePayload(message.value),
      ...(message.key !== null && message.key !== undefined
        ? { key: message.key.toString('utf8') }
        : {}),
      delivery: { partition, offset: message.offset },
    };
    try {
      // The CONSUMER span (including the error case) is recorded by BaseTransport's wrapper.
      const result = await handler(inbound);
      await this.maybeReply(headers, result);
    } catch (err) {
      await this.sendToDlq(topic, message, err);
    }
  }

  /** Responder side of emulated request/reply: route the handler's return value back. */
  private async maybeReply(headers: Record<string, string>, result: unknown): Promise<void> {
    const replyTo = headers[REPLY_TO_HEADER];
    const correlationId = headers[HEADERS.CORRELATION_ID];
    if (replyTo === undefined || correlationId === undefined || result === undefined) return;
    await this.publish({
      channel: replyTo,
      headers: { [HEADERS.CORRELATION_ID]: correlationId },
      payload: result,
    });
  }

  /**
   * Poison-message policy: publish the ORIGINAL message (value + headers) to
   * `<topic>.dlq` and return normally so the offset commits. If the DLQ
   * publish itself fails, rethrow the original error so kafkajs redelivers
   * (at-least-once) instead of losing the message.
   */
  private async sendToDlq(topic: string, message: KafkaMessage, err: unknown): Promise<void> {
    if (!this.dlqEnabled) throw err;
    try {
      await this.producer.send({
        topic: `${topic}${DLQ_SUFFIX}`,
        messages: [
          {
            key: message.key,
            value: message.value,
            headers: {
              ...(message.headers ?? {}),
              [DLQ_ERROR_HEADER]: describeError(err),
              [DLQ_SOURCE_TOPIC_HEADER]: topic,
            },
          },
        ],
      });
    } catch {
      throw err;
    }
  }

  private async ensureReplyConsumer(): Promise<void> {
    if (this.replyConsumer) return;
    const consumer = this.kafka.consumer({ groupId: `${this.replyTopic}.group` });
    await consumer.connect();
    await consumer.subscribe({ topic: this.replyTopic });
    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        const headers = decodeHeaders(message.headers);
        const correlationId = headers[HEADERS.CORRELATION_ID];
        if (correlationId === undefined) return;
        this.replies.resolve(correlationId, {
          channel: topic,
          headers,
          payload: parsePayload(message.value),
        });
      },
    });
    this.replyConsumer = consumer;
  }
}
