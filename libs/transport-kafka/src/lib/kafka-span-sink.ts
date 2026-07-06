import { TRACING_CHANNEL, type SpanEvent } from '@ariadne/protocol';
import type { SpanSink } from '@ariadne/transport-core';
import { Kafka, type KafkaConfig as KafkaJsConfig, type Producer } from 'kafkajs';

export interface KafkaSpanSinkOptions {
  readonly brokers: readonly string[];
  readonly clientId: string;
  /** Defaults to `_tracing`. */
  readonly topic?: string;
  readonly ssl?: KafkaJsConfig['ssl'];
  readonly sasl?: KafkaJsConfig['sasl'];
}

/**
 * The tracing producer, on its OWN Kafka client — it shares no sockets or
 * retry state with business traffic (spec §4 fail-safe rule, by construction).
 * Retries are deliberately tight: if `_tracing` is down this sink fails fast
 * and the BoundedSpanEmitter drops the batch instead of building backpressure.
 */
export class KafkaSpanSink implements SpanSink {
  private readonly producer: Producer;
  private readonly topic: string;
  private connected = false;

  constructor(options: KafkaSpanSinkOptions) {
    const kafka = new Kafka({
      clientId: `${options.clientId}-tracing`,
      brokers: [...options.brokers],
      ...(options.ssl !== undefined ? { ssl: options.ssl } : {}),
      ...(options.sasl !== undefined ? { sasl: options.sasl } : {}),
      retry: { retries: 1, initialRetryTime: 100 },
      requestTimeout: 5_000,
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
    this.topic = options.topic ?? TRACING_CHANNEL;
  }

  async sendBatch(spans: readonly SpanEvent[]): Promise<void> {
    if (!this.connected) {
      await this.producer.connect();
      this.connected = true;
    }
    await this.producer.send({
      topic: this.topic,
      acks: 1,
      messages: spans.map((span) => ({
        // Keyed by traceId so a trace's spans stay in one partition (ordered per trace).
        key: span.traceId,
        value: JSON.stringify(span),
      })),
    });
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await this.producer.disconnect();
  }
}
