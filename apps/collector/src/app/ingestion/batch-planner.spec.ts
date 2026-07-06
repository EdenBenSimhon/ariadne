import { planBatch, type PlannerMessage, type PlannerOptions } from './batch-planner';

const NOW = Date.parse('2026-07-06T12:00:00.000Z');

const OPTS: PlannerOptions = {
  maxChunkSpans: 3,
  maxMessageBytes: 64 * 1024,
  maxSpanAgeMs: 7 * 86_400_000,
  maxSpanFutureMs: 86_400_000,
  now: NOW,
};

let seq = 0;
function validSpanMessage(offset: string, overrides: Record<string, unknown> = {}): PlannerMessage {
  seq += 1;
  return {
    offset,
    value: Buffer.from(
      JSON.stringify({
        traceId: 'f'.repeat(32),
        spanId: seq.toString(16).padStart(16, '0'),
        parentSpanId: null,
        tenantId: 'acme',
        serviceName: 'order-service',
        spanKind: 'PRODUCER',
        transport: 'kafka',
        channel: 'orders.created',
        operationName: 'publish orders.created',
        startTime: '2026-07-06T11:59:00.000Z',
        durationMs: 10,
        status: 'OK',
        error: null,
        metadata: null,
        ...overrides,
      })
    ),
  };
}

describe('planBatch', () => {
  it('returns an empty plan for an empty batch', () => {
    const plan = planBatch([], OPTS);
    expect(plan.chunks).toEqual([]);
    expect(plan.finalOffset).toBeNull();
    expect(plan.invalid.count).toBe(0);
  });

  it('chunks valid spans at maxChunkSpans with correct resolve offsets', () => {
    const plan = planBatch(
      ['0', '1', '2', '3', '4'].map((offset) => validSpanMessage(offset)),
      OPTS
    );
    expect(plan.chunks).toHaveLength(2);
    expect(plan.chunks[0]?.spans).toHaveLength(3);
    expect(plan.chunks[0]?.resolveUpToOffset).toBe('2');
    expect(plan.chunks[1]?.spans).toHaveLength(2);
    expect(plan.chunks[1]?.resolveUpToOffset).toBe('4');
    expect(plan.finalOffset).toBe('4');
  });

  it('counts invalid messages by reason and keeps their offsets covered', () => {
    const plan = planBatch(
      [
        validSpanMessage('0'),
        { offset: '1', value: Buffer.from('not json at all') },
        { offset: '2', value: Buffer.from(JSON.stringify({ nope: true })) },
        { offset: '3', value: null },
        { offset: '4', value: Buffer.alloc(OPTS.maxMessageBytes + 1, 120) },
        validSpanMessage('5', { startTime: '1970-01-01T00:00:00.000Z' }),
        validSpanMessage('6', { startTime: '2026-07-09T12:00:00.000Z' }),
        validSpanMessage('7'),
      ],
      OPTS
    );
    expect(plan.invalid.count).toBe(6);
    expect(plan.invalid.reasons).toEqual({
      'bad-json': 1,
      schema: 1,
      empty: 1,
      oversized: 1,
      'timestamp-out-of-range': 2,
    });
    // 2 valid spans → single trailing chunk resolved at the LAST batch offset.
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]?.spans).toHaveLength(2);
    expect(plan.chunks[0]?.resolveUpToOffset).toBe('7');
  });

  it('covers trailing invalid messages through finalOffset when no chunk follows them', () => {
    const plan = planBatch(
      [
        validSpanMessage('0'),
        validSpanMessage('1'),
        validSpanMessage('2'),
        { offset: '3', value: Buffer.from('garbage') },
      ],
      OPTS
    );
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]?.resolveUpToOffset).toBe('2');
    expect(plan.finalOffset).toBe('3');
  });

  it('handles a batch of only invalid messages', () => {
    const plan = planBatch([{ offset: '0', value: Buffer.from('junk') }], OPTS);
    expect(plan.chunks).toEqual([]);
    expect(plan.finalOffset).toBe('0');
    expect(plan.invalid.count).toBe(1);
  });

  it('never echoes payload content in the plan (log-injection safety)', () => {
    const hostile = Buffer.from('"\\u001b[2J{evil}"');
    const plan = planBatch([{ offset: '0', value: hostile }], OPTS);
    expect(JSON.stringify(plan)).not.toContain('evil');
  });
});

describe('planBatch timestamp window', () => {
  it('accepts spans exactly at the window edges', () => {
    const atOldest = validSpanMessage('0', {
      startTime: new Date(NOW - OPTS.maxSpanAgeMs).toISOString(),
    });
    const atNewest = validSpanMessage('1', {
      startTime: new Date(NOW + OPTS.maxSpanFutureMs).toISOString(),
    });
    const plan = planBatch([atOldest, atNewest], OPTS);
    expect(plan.invalid.count).toBe(0);
    expect(plan.chunks[0]?.spans).toHaveLength(2);
  });
});
