import type { KafkaConfig as KafkaJsConfig } from 'kafkajs';

export interface KafkaTransportConfig {
  readonly brokers: readonly string[];
  /** Defaults to the runtime serviceName. */
  readonly clientId?: string;
  /** Consumer group. Defaults to `svc.<serviceName>` (spec §7: group per service). */
  readonly groupId?: string;
  /** Transport auth (security B1). */
  readonly ssl?: KafkaJsConfig['ssl'];
  readonly sasl?: KafkaJsConfig['sasl'];
  readonly requestReply?: {
    /** Default reply timeout for emulated request/reply. Defaults to 30s. */
    readonly timeoutMs?: number;
  };
  readonly dlq?: {
    /** Route poison messages to `<topic>.dlq` instead of endless redelivery. Default true. */
    readonly enabled?: boolean;
  };
}

/** Kafka-emulation header: where to publish the reply of a request (spec §7). */
export const REPLY_TO_HEADER = 'x-reply-to';
export const DLQ_ERROR_HEADER = 'x-dlq-error';
export const DLQ_SOURCE_TOPIC_HEADER = 'x-dlq-source-topic';
