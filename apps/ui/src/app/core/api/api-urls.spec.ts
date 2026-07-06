import { statsUrl, topologyUrl, tracesUrl, traceUrl } from './api-urls';

describe('api urls', () => {
  it('omits unset filters', () => {
    expect(tracesUrl()).toBe('/api/traces');
    expect(tracesUrl({ cursor: null, service: null, status: null })).toBe('/api/traces');
  });

  it('encodes set filters', () => {
    expect(tracesUrl({ limit: 25, service: 'order-service', status: 'error' })).toBe(
      '/api/traces?limit=25&service=order-service&status=error'
    );
  });

  it('escapes the trace id path segment', () => {
    expect(traceUrl('abc/def')).toBe('/api/traces/abc%2Fdef');
  });

  it('exposes fixed endpoints', () => {
    expect(topologyUrl()).toBe('/api/topology');
    expect(statsUrl()).toBe('/api/stats');
  });
});
