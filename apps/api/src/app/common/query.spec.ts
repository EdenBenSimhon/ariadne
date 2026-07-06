import { traceIdSchema } from '@ariadne/protocol';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { decodeCursor, encodeCursor, parseQuery, resolveWindow } from './query';

const traceId = traceIdSchema.parse('f'.repeat(32));

describe('cursor codec', () => {
  it('round-trips', () => {
    const startTime = new Date('2026-07-06T12:00:00.000Z');
    const decoded = decodeCursor(encodeCursor(startTime, traceId));
    expect(decoded.startTime).toEqual(startTime);
    expect(decoded.traceId).toBe(traceId);
  });

  it.each([
    ['garbage', 'not-base64url-!!!'],
    ['non-numeric ms', Buffer.from(`abc:${traceId}`).toString('base64url')],
    ['bad trace id', Buffer.from('1234:nothex').toString('base64url')],
    ['missing separator', Buffer.from('12345').toString('base64url')],
  ])('rejects a tampered cursor: %s', (_name, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
  });
});

describe('parseQuery', () => {
  const schema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

  it('applies defaults and coercion', () => {
    expect(parseQuery(schema, {})).toEqual({ limit: 20 });
    expect(parseQuery(schema, { limit: '50' })).toEqual({ limit: 50 });
  });

  it('rejects out-of-bounds values with issue paths, not echoed values', () => {
    try {
      parseQuery(schema, { limit: '101' });
      fail('expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as { issues: unknown[] };
      expect(JSON.stringify(body)).not.toContain('101');
      expect(body.issues).toHaveLength(1);
    }
  });
});

describe('resolveWindow', () => {
  const bounds = { lookbackMs: 24 * 3_600_000, maxWindowMs: 31 * 86_400_000 };
  const now = Date.parse('2026-07-07T00:00:00.000Z');

  it('defaults to the lookback window ending now', () => {
    const window = resolveWindow({}, bounds, now);
    expect(window.to.getTime()).toBe(now);
    expect(window.from.getTime()).toBe(now - bounds.lookbackMs);
  });

  it('rejects from > to', () => {
    expect(() =>
      resolveWindow(
        { from: '2026-07-07T00:00:00Z', to: '2026-07-06T00:00:00Z' },
        bounds,
        now
      )
    ).toThrow(BadRequestException);
  });

  it('rejects windows larger than the cap (query-cost bound, B3)', () => {
    expect(() =>
      resolveWindow(
        { from: '2026-01-01T00:00:00Z', to: '2026-07-01T00:00:00Z' },
        bounds,
        now
      )
    ).toThrow(BadRequestException);
  });
});
