import { isSpanId, isTraceId, newCorrelationId, newSpanId, newTraceId } from './ids';
import { spanIdSchema, traceIdSchema } from './schemas/primitives';

describe('ids', () => {
  it('generates trace ids as 32 lowercase hex chars that pass the schema', () => {
    const id = newTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(traceIdSchema.safeParse(id).success).toBe(true);
  });

  it('generates span ids as 16 lowercase hex chars that pass the schema', () => {
    const id = newSpanId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(spanIdSchema.safeParse(id).success).toBe(true);
  });

  it('generates correlation ids in span-id format', () => {
    expect(newCorrelationId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('generates unique ids', () => {
    const sample = new Set(Array.from({ length: 1000 }, () => newSpanId()));
    expect(sample.size).toBe(1000);
  });

  describe('guards', () => {
    it('accepts valid ids', () => {
      expect(isTraceId('f'.repeat(32))).toBe(true);
      expect(isSpanId('f'.repeat(16))).toBe(true);
    });

    it('rejects all-zero, wrong length, uppercase and non-hex', () => {
      expect(isTraceId('0'.repeat(32))).toBe(false);
      expect(isSpanId('0'.repeat(16))).toBe(false);
      expect(isTraceId('f'.repeat(16))).toBe(false);
      expect(isSpanId('f'.repeat(32))).toBe(false);
      expect(isTraceId('F'.repeat(32))).toBe(false);
      expect(isSpanId('g'.repeat(16))).toBe(false);
    });
  });
});
