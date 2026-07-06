import { loadApiConfig } from './api-config';

describe('loadApiConfig', () => {
  it('provides working defaults with the reader role', () => {
    const config = loadApiConfig({});
    expect(config.databaseUrl).toContain('eventtracer_reader');
    expect(config.maxPageSize).toBe(100);
    expect(config.defaultPageSize).toBe(20);
    expect(config.topologyMaxRows).toBe(50_000);
    expect(config.port).toBe(3000);
  });

  it('fails boot loudly on malformed values', () => {
    expect(() => loadApiConfig({ API_MAX_PAGE_SIZE: 'many' })).toThrow();
    expect(() => loadApiConfig({ API_DB_SSL: 'yes' })).toThrow();
  });
});
