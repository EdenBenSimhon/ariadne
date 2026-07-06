import { loadCollectorConfig } from './collector-config';

describe('loadCollectorConfig', () => {
  it('provides working defaults', () => {
    const config = loadCollectorConfig({});
    expect(config.brokers).toEqual(['localhost:9092']);
    expect(config.groupId).toBe('eventtracer-collector-group');
    expect(config.tracingTopic).toBe('_tracing');
    expect(config.batchMaxSpans).toBe(100);
    expect(config.batchMaxWaitMs).toBe(500);
    expect(config.dbSsl).toBe(false);
    expect(config.fromBeginning).toBe(true);
    expect(config.port).toBe(3001);
    expect(config.maxSpanAgeMs).toBe(7 * 86_400_000);
  });

  it('parses a csv broker list', () => {
    const config = loadCollectorConfig({
      COLLECTOR_KAFKA_BROKERS: 'kafka-1:9092, kafka-2:9092 ,kafka-3:9092',
    });
    expect(config.brokers).toEqual(['kafka-1:9092', 'kafka-2:9092', 'kafka-3:9092']);
  });

  it('rejects malformed values instead of silently falling back', () => {
    expect(() => loadCollectorConfig({ COLLECTOR_BATCH_MAX_SPANS: 'lots' })).toThrow();
    expect(() => loadCollectorConfig({ COLLECTOR_DB_SSL: 'yes' })).toThrow();
    expect(() => loadCollectorConfig({ PORT: '99999' })).toThrow();
    expect(() => loadCollectorConfig({ COLLECTOR_KAFKA_BROKERS: ' , ' })).toThrow();
  });
});
