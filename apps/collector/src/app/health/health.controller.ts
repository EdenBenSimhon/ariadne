import type { TraceStore } from '@ariadne/storage';
import { Controller, Get, Inject } from '@nestjs/common';
import { IngestionMetrics } from '../ingestion/ingestion-metrics';
import { TracingConsumerService } from '../ingestion/tracing-consumer.service';
import { TRACE_STORE } from '../storage/storage.module';

const DB_PING_TIMEOUT_MS = 2_000;

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    timer.unref?.();
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

@Controller()
export class HealthController {
  constructor(
    @Inject(TRACE_STORE) private readonly store: TraceStore,
    private readonly consumer: TracingConsumerService,
    private readonly metrics: IngestionMetrics
  ) {}

  @Get('healthz')
  async health() {
    let db: 'ok' | 'error' = 'ok';
    try {
      await withTimeout(this.store.ping(), DB_PING_TIMEOUT_MS);
    } catch {
      db = 'error';
    }
    const kafka = this.consumer.isRunning;
    return {
      status: db === 'ok' && kafka ? 'ok' : 'degraded',
      kafka,
      db,
      counters: this.metrics.snapshot(),
    };
  }
}
