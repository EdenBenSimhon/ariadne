import type { SpanEvent } from '@ariadne/protocol';
import type { TraceStore } from '@ariadne/storage';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Kafka, type Consumer, type EachBatchPayload } from 'kafkajs';
import { COLLECTOR_CONFIG, type CollectorConfig } from '../config/collector-config';
import { TRACE_STORE } from '../storage/storage.module';
import { planBatch } from './batch-planner';
import { IngestionMetrics } from './ingestion-metrics';

/**
 * Consumes `_tracing` with raw kafkajs (spec §8) — deliberately NOT through
 * KafkaTransport: the collector must never emit spans about itself (feedback
 * loop into `_tracing`) and needs batch-level offset control.
 *
 * "100 spans or 500 ms" is realized at the broker fetch (`minBytes` +
 * `maxWaitTimeInMs`) plus ≤100-span write chunks inside each batch. Nothing
 * buffers outside the handler, so offsets always trail committed DB writes —
 * with `ON CONFLICT DO NOTHING` dedupe, that is effectively-once storage.
 *
 * DB-down policy: bounded in-handler retries (heartbeating between attempts),
 * then rethrow — kafkajs restarts the consumer; on a non-restartable crash we
 * SIGTERM ourselves and let compose/Kubernetes restart the process. Not
 * consuming IS the backpressure: messages wait on the broker.
 */
@Injectable()
export class TracingConsumerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('TracingConsumer');
  private readonly consumer: Consumer;
  private running = false;

  constructor(
    @Inject(COLLECTOR_CONFIG) private readonly config: CollectorConfig,
    @Inject(TRACE_STORE) private readonly store: TraceStore,
    private readonly metrics: IngestionMetrics
  ) {
    const kafka = new Kafka({ clientId: 'eventtracer-collector', brokers: [...config.brokers] });
    this.consumer = kafka.consumer({
      groupId: config.groupId,
      maxWaitTimeInMs: config.batchMaxWaitMs,
      minBytes: config.batchMinBytes,
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  async onApplicationBootstrap(): Promise<void> {
    this.consumer.on(this.consumer.events.CRASH, (event) => {
      if (!event.payload.restart) {
        this.logger.error(
          `consumer crashed non-restartably (${event.payload.error?.message ?? 'unknown'}); exiting for a clean restart`
        );
        this.running = false;
        process.kill(process.pid, 'SIGTERM');
      }
    });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.config.tracingTopic,
      fromBeginning: this.config.fromBeginning,
    });
    await this.consumer.run({
      eachBatchAutoResolve: false,
      eachBatch: (payload) => this.handleBatch(payload),
    });
    this.running = true;
    this.logger.log(
      `consuming '${this.config.tracingTopic}' as '${this.config.groupId}' from ${this.config.brokers.join(',')}`
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    // stop() awaits the in-flight eachBatch — that IS the flush, since
    // nothing is buffered outside the handler.
    await this.consumer.stop().catch(() => undefined);
    await this.consumer.disconnect().catch(() => undefined);
  }

  async handleBatch(payload: EachBatchPayload): Promise<void> {
    const { batch, resolveOffset, heartbeat, isRunning, isStale } = payload;
    const plan = planBatch(
      batch.messages.map((message) => ({ offset: message.offset, value: message.value })),
      {
        maxChunkSpans: this.config.batchMaxSpans,
        maxMessageBytes: this.config.maxMessageBytes,
        maxSpanAgeMs: this.config.maxSpanAgeMs,
        maxSpanFutureMs: this.config.maxSpanFutureMs,
        now: Date.now(),
      }
    );
    this.metrics.recordInvalid(plan.invalid);

    for (const chunk of plan.chunks) {
      if (!isRunning() || isStale()) return;
      const result = await this.writeWithRetry(chunk.spans, heartbeat);
      this.metrics.recordWrite(result);
      resolveOffset(chunk.resolveUpToOffset);
      await heartbeat();
    }

    // Trailing invalid messages are handled (counted), not retried.
    if (plan.finalOffset !== null && isRunning() && !isStale()) {
      resolveOffset(plan.finalOffset);
      await heartbeat();
    }
  }

  private async writeWithRetry(
    spans: readonly SpanEvent[],
    heartbeat: () => Promise<void>
  ): Promise<{ received: number; inserted: number; duplicates: number }> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.store.insertSpans(spans);
      } catch (err) {
        if (!isTransientDbError(err)) {
          // Data-level failure: one poison span must not wedge the partition.
          return this.insertRowByRow(spans);
        }
        if (attempt >= this.config.dbRetryAttempts) throw err;
        this.metrics.recordDbRetry();
        await heartbeat();
        await sleep(Math.min(250 * 2 ** (attempt - 1), 4_000));
      }
    }
  }

  private async insertRowByRow(
    spans: readonly SpanEvent[]
  ): Promise<{ received: number; inserted: number; duplicates: number }> {
    let inserted = 0;
    let duplicates = 0;
    let failed = 0;
    for (const span of spans) {
      try {
        const result = await this.store.insertSpans([span]);
        inserted += result.inserted;
        duplicates += result.duplicates;
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) {
      this.metrics.recordRowFallbackFailure(failed);
      this.logger.warn(`row-by-row fallback dropped ${failed} span(s) rejected by the database`);
    }
    return { received: spans.length, inserted, duplicates };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Connection/resource/serialization errors are worth retrying; data errors are not. */
export function isTransientDbError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code)) {
    return true;
  }
  // SQLSTATE classes: 08 connection, 53 insufficient resources, 57 operator
  // intervention (shutdown); 40001/40P01 serialization/deadlock.
  return (
    code.startsWith('08') ||
    code.startsWith('53') ||
    code.startsWith('57') ||
    code === '40001' ||
    code === '40P01'
  );
}
