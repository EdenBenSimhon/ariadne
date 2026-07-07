import { decide, ruleConfigSchemas } from './evaluate';

describe('alert rule decisions', () => {
  it('error-rate breaches only above the threshold and never on empty windows', () => {
    const config = { threshold: 0.1 };
    expect(decide(config, { kind: 'error-rate', errorRate: 0.5, traceCount: 10 }).state).toBe('breach');
    expect(decide(config, { kind: 'error-rate', errorRate: 0.05, traceCount: 10 }).state).toBe('ok');
    expect(decide(config, { kind: 'error-rate', errorRate: 1, traceCount: 0 }).state).toBe('ok');
  });

  it('latency-p95 tolerates a null p95 (no traffic)', () => {
    const config = { thresholdMs: 200 };
    expect(decide(config, { kind: 'latency-p95', p95DurationMs: 500 }).state).toBe('breach');
    expect(decide(config, { kind: 'latency-p95', p95DurationMs: null }).state).toBe('ok');
  });

  it('flow-missing fires when the watched signature disappears', () => {
    const config = { signature: 'order -[orders.created]-> inventory' };
    expect(decide(config, { kind: 'flow-missing', present: false }).state).toBe('breach');
    expect(decide(config, { kind: 'flow-missing', present: false }).message).toContain('stopped running');
    expect(decide(config, { kind: 'flow-missing', present: true }).state).toBe('ok');
  });

  it('flow-drift fires on any change and carries the top reason', () => {
    const verdict = decide({}, { kind: 'flow-drift', changeCount: 2, topReason: 'error rate moved 0% -> 40%' });
    expect(verdict.state).toBe('breach');
    expect(verdict.message).toContain('error rate moved');
    expect(decide({}, { kind: 'flow-drift', changeCount: 0, topReason: null }).state).toBe('ok');
  });

  it('service-silent fires only at exactly zero spans', () => {
    const config = { service: 'payment-service' };
    expect(decide(config, { kind: 'service-silent', spanCount: 0 }).state).toBe('breach');
    expect(decide(config, { kind: 'service-silent', spanCount: 1 }).state).toBe('ok');
  });

  it('config schemas reject out-of-range values', () => {
    expect(ruleConfigSchemas['error-rate'].safeParse({ threshold: 2 }).success).toBe(false);
    expect(ruleConfigSchemas['latency-p95'].safeParse({ thresholdMs: 0 }).success).toBe(false);
    expect(ruleConfigSchemas['flow-missing'].safeParse({ signature: '' }).success).toBe(false);
    expect(
      ruleConfigSchemas['error-rate'].safeParse({ threshold: 0.2 }).success
    ).toBe(true);
  });
});
