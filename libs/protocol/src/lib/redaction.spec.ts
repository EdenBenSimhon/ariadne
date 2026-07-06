import { LIMITS } from './constants';
import { redactMetadata } from './redaction';

const ALLOWLIST = ['orderId', 'amount', 'ok'] as const;

describe('redactMetadata', () => {
  it('keeps only allowlisted keys', () => {
    const result = redactMetadata(
      { orderId: 'ord-1', creditCard: '4111-1111', amount: 10, ok: true },
      ALLOWLIST
    );
    expect(result).toEqual({ orderId: 'ord-1', amount: 10, ok: true });
  });

  it('returns null when nothing survives, for non-object input, and for empty allowlists', () => {
    expect(redactMetadata({ secret: 'x' }, ALLOWLIST)).toBeNull();
    expect(redactMetadata('a string', ALLOWLIST)).toBeNull();
    expect(redactMetadata(['a'], ALLOWLIST)).toBeNull();
    expect(redactMetadata(null, ALLOWLIST)).toBeNull();
    expect(redactMetadata({ orderId: 'x' }, [])).toBeNull();
  });

  it('truncates oversized string values', () => {
    const result = redactMetadata({ orderId: 'x'.repeat(500) }, ALLOWLIST);
    expect(result?.['orderId']).toHaveLength(LIMITS.METADATA_MAX_VALUE_LEN);
  });

  it('drops non-primitive and non-finite values (flat primitives only)', () => {
    const result = redactMetadata(
      { orderId: { nested: true }, amount: Number.POSITIVE_INFINITY, ok: true },
      ALLOWLIST
    );
    expect(result).toEqual({ ok: true });
  });

  it('drops prototype-pollution keys even when allowlisted', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "orderId": "ord-1"}');
    const result = redactMetadata(input, ['__proto__', 'orderId']);
    expect(result).toEqual({ orderId: 'ord-1' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('caps the number of kept keys', () => {
    const input = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i]));
    const allowlist = Object.keys(input);
    const result = redactMetadata(input, allowlist);
    expect(Object.keys(result ?? {})).toHaveLength(LIMITS.METADATA_MAX_KEYS);
  });
});
