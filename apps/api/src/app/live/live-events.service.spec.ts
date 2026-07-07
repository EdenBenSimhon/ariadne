import type { LiveEvent, TraceLiveEvent } from '@ariadne/graph';
import type { StoredTrace, TraceReader } from '@ariadne/storage';
import type { ApiConfig } from '../config/api-config';
import { LiveEventsService } from './live-events.service';

function trace(id: string, startMs: number, hasError = false): StoredTrace {
  return {
    tenantId: 'acme',
    traceId: id,
    rootService: 'order-service',
    spanCount: 3,
    startTime: new Date(startMs),
    endTime: new Date(startMs + 100),
    durationMs: 100,
    hasError,
  } as unknown as StoredTrace;
}

const CONFIG = { liveStreamPollMs: 1_000, liveStreamBackfill: 25 } as ApiConfig;
const TENANT = 'acme' as Parameters<LiveEventsService['stream']>[0];

describe('LiveEventsService', () => {
  let listTraces: jest.Mock<Promise<StoredTrace[]>, unknown[]>;
  let reader: TraceReader;
  let service: LiveEventsService;

  beforeEach(() => {
    jest.useFakeTimers();
    listTraces = jest.fn();
    reader = { listTraces } as unknown as TraceReader;
    service = new LiveEventsService(reader, CONFIG);
  });

  afterEach(() => {
    service.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('primes the watermark on the first poll and does NOT replay history as live events', async () => {
    listTraces.mockResolvedValue([trace('a'.repeat(32), 1_000)]);
    const seen: LiveEvent[] = [];
    const sub = service.stream(TENANT).subscribe((e) => seen.push(e));

    await jest.advanceTimersByTimeAsync(1); // flush the immediate prime poll
    expect(seen).toEqual([]); // existing trace is backfill's job, not the live stream's
    sub.unsubscribe();
  });

  it('emits a trace event when a newer trace appears', async () => {
    listTraces.mockResolvedValueOnce([trace('a'.repeat(32), 1_000)]); // prime
    const seen: TraceLiveEvent[] = [];
    const sub = service.stream(TENANT).subscribe((e) => e.kind === 'trace' && seen.push(e));
    await jest.advanceTimersByTimeAsync(1);

    // a newer trace shows up
    listTraces.mockResolvedValue([trace('b'.repeat(32), 2_000, true), trace('a'.repeat(32), 1_000)]);
    await jest.advanceTimersByTimeAsync(1_000);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.trace.traceId).toBe('b'.repeat(32));
    expect(seen[0]?.trace.hasError).toBe(true);
    sub.unsubscribe();
  });

  it('advances the watermark so a trace is never emitted twice', async () => {
    listTraces.mockResolvedValueOnce([trace('a'.repeat(32), 1_000)]);
    const seen: TraceLiveEvent[] = [];
    const sub = service.stream(TENANT).subscribe((e) => e.kind === 'trace' && seen.push(e));
    await jest.advanceTimersByTimeAsync(1);

    listTraces.mockResolvedValue([trace('b'.repeat(32), 2_000)]);
    await jest.advanceTimersByTimeAsync(1_000); // emits b
    await jest.advanceTimersByTimeAsync(1_000); // same row again — must NOT re-emit

    expect(seen).toHaveLength(1);
    sub.unsubscribe();
  });

  it('stops polling once the last subscriber leaves', async () => {
    listTraces.mockResolvedValue([trace('a'.repeat(32), 1_000)]);
    const sub = service.stream(TENANT).subscribe();
    await jest.advanceTimersByTimeAsync(1);
    const callsWhileSubscribed = listTraces.mock.calls.length;

    sub.unsubscribe();
    await jest.advanceTimersByTimeAsync(5_000);
    expect(listTraces.mock.calls.length).toBe(callsWhileSubscribed); // no polls after teardown
  });

  it('recent() returns a newest-first snapshot of distilled trace events', async () => {
    listTraces.mockResolvedValue([trace('b'.repeat(32), 2_000), trace('a'.repeat(32), 1_000)]);
    const events = await service.recent(TENANT, 25);
    expect(events.map((e) => e.trace.traceId)).toEqual(['b'.repeat(32), 'a'.repeat(32)]);
    expect(events.every((e) => e.kind === 'trace')).toBe(true);
  });
});
