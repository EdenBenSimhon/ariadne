import { TRACING_CHANNEL, type SpanEvent } from '@ariadne/protocol';
import type { SpanSink } from '@ariadne/transport-core';
import { connect, type Channel, type ChannelModel } from 'amqplib';

export interface RabbitSpanSinkOptions {
  /** AMQP connection URL — may point at the same broker as app traffic. */
  readonly url: string;
  /** Durable queue span events are written to. Defaults to `_tracing`. */
  readonly queue?: string;
}

/**
 * The tracing producer, on its OWN AMQP connection — it shares no sockets,
 * channels or retry state with business traffic (spec §4 fail-safe rule, by
 * construction). Deliberately tight: if the broker is unreachable this sink
 * fails fast and the BoundedSpanEmitter drops the batch instead of building
 * backpressure into business code.
 *
 * Spans are published as individual persistent messages to a durable queue
 * via the default exchange (`sendToQueue`) — the collector consumes them one
 * by one, exactly like the Kafka `_tracing` topic.
 */
export class RabbitSpanSink implements SpanSink {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
  private readonly queue: string;

  constructor(private readonly options: RabbitSpanSinkOptions) {
    this.queue = options.queue ?? TRACING_CHANNEL;
  }

  async sendBatch(spans: readonly SpanEvent[]): Promise<void> {
    const channel = await this.ensureChannel();
    for (const span of spans) {
      channel.sendToQueue(this.queue, Buffer.from(JSON.stringify(span), 'utf8'), {
        persistent: true,
      });
    }
  }

  async close(): Promise<void> {
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    if (channel) await channel.close().catch(() => undefined);
    if (connection) await connection.close().catch(() => undefined);
  }

  private async ensureChannel(): Promise<Channel> {
    if (this.channel) return this.channel;
    // Connect lazily and fail fast: any error here propagates to the emitter,
    // which counts the drop — business traffic never waits on `_tracing`.
    this.connection = await connect(this.options.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertQueue(this.queue, { durable: true });
    return this.channel;
  }
}
