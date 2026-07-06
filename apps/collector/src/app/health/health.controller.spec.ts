import type { TraceStore } from '@ariadne/storage';
import { IngestionMetrics } from '../ingestion/ingestion-metrics';
import type { TracingConsumerService } from '../ingestion/tracing-consumer.service';
import { HealthController } from './health.controller';

function makeController(pingOk: boolean, kafkaRunning: boolean) {
  const store = {
    ping: pingOk ? jest.fn(async () => undefined) : jest.fn(async () => Promise.reject(new Error('db down'))),
  } as unknown as TraceStore;
  const consumer = { isRunning: kafkaRunning } as TracingConsumerService;
  const metrics = new IngestionMetrics();
  metrics.recordWrite({ received: 5, inserted: 4, duplicates: 1 });
  return new HealthController(store, consumer, metrics);
}

describe('HealthController', () => {
  it('reports ok when kafka and db are healthy, with counters', async () => {
    const result = await makeController(true, true).health();
    expect(result.status).toBe('ok');
    expect(result.kafka).toBe(true);
    expect(result.db).toBe('ok');
    expect(result.counters.spansIngested).toBe(4);
    expect(result.counters.spansDuplicate).toBe(1);
  });

  it('degrades when the database ping fails', async () => {
    const result = await makeController(false, true).health();
    expect(result.status).toBe('degraded');
    expect(result.db).toBe('error');
  });

  it('degrades when the consumer is not running', async () => {
    const result = await makeController(true, false).health();
    expect(result.status).toBe('degraded');
    expect(result.kafka).toBe(false);
  });
});
