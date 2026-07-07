import type { TenantId } from '@ariadne/protocol';
import type { LiveEvent, TraceLiveEvent } from '@ariadne/graph';
import type { StoredTrace, TraceReader } from '@ariadne/storage';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { TRACE_READER } from '../storage/storage.module';
import { toTraceSummary } from '../traces/traces.service';

interface Watermark {
  readonly startTime: number;
  readonly traceId: string;
}

interface TenantStream {
  readonly subject: Subject<LiveEvent>;
  watermark: Watermark | null;
  timer: ReturnType<typeof setInterval> | null;
  refCount: number;
  polling: boolean;
}

/** Strict "after" ordering on the keyset (startTime, traceId) — matches the reader's sort. */
function isAfter(a: Watermark, b: Watermark): boolean {
  return a.startTime > b.startTime || (a.startTime === b.startTime && a.traceId > b.traceId);
}

/**
 * Realtime activity without coupling processes: the API already owns a
 * SELECT-only reader, so a single per-tenant poller watches the pre-computed
 * `traces` table and fans new rows out to every SSE subscriber over one
 * RxJS Subject. Ref-counted — polling only runs while someone is listening,
 * and the timer is `unref`'d so it never keeps the process alive. Events are
 * trace summaries (already distilled), never raw spans (security B4).
 *
 * The DB poll is the pragmatic MVP seam; a Postgres `LISTEN/NOTIFY` from the
 * collector, or a dedicated bus, drops in behind this same Observable later.
 */
@Injectable()
export class LiveEventsService implements OnApplicationShutdown {
  private readonly logger = new Logger(LiveEventsService.name);
  private readonly streams = new Map<string, TenantStream>();

  constructor(
    @Inject(TRACE_READER) private readonly reader: TraceReader,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  /** Live trace/heartbeat events for a tenant. Starts the poller lazily. */
  stream(tenantId: TenantId): Observable<LiveEvent> {
    const key = tenantId as string;
    return new Observable<LiveEvent>((subscriber) => {
      const state = this.acquire(key, tenantId);
      const sub = state.subject.subscribe(subscriber);
      return () => {
        sub.unsubscribe();
        this.release(key);
      };
    });
  }

  /** Newest-first snapshot of recent activity — the non-streaming "log". */
  async recent(tenantId: TenantId, limit: number): Promise<TraceLiveEvent[]> {
    const rows = await this.reader.listTraces(tenantId, { limit });
    return rows.slice(0, limit).map((row) => this.toEvent(row, row.endTime.toISOString()));
  }

  private toEvent(row: StoredTrace, at: string): TraceLiveEvent {
    return { kind: 'trace', at, trace: toTraceSummary(row) };
  }

  private acquire(key: string, tenantId: TenantId): TenantStream {
    let state = this.streams.get(key);
    if (state === undefined) {
      state = { subject: new Subject<LiveEvent>(), watermark: null, timer: null, refCount: 0, polling: false };
      this.streams.set(key, state);
    }
    state.refCount += 1;
    if (state.timer === null) {
      // Prime the watermark immediately (no backlog replay), then poll on interval.
      void this.poll(tenantId, state);
      state.timer = setInterval(() => void this.poll(tenantId, state), this.config.liveStreamPollMs);
      if (typeof state.timer.unref === 'function') state.timer.unref();
    }
    return state;
  }

  private release(key: string): void {
    const state = this.streams.get(key);
    if (state === undefined) return;
    state.refCount -= 1;
    if (state.refCount <= 0) this.stop(key, state);
  }

  private stop(key: string, state: TenantStream): void {
    if (state.timer !== null) clearInterval(state.timer);
    state.timer = null;
    state.polling = false;
    state.subject.complete();
    this.streams.delete(key);
  }

  private async poll(tenantId: TenantId, state: TenantStream): Promise<void> {
    if (state.polling) return; // never overlap a slow query with the next tick
    state.polling = true;
    try {
      const rows = await this.reader.listTraces(tenantId, { limit: this.config.liveStreamBackfill });
      if (state.watermark === null) {
        // First tick just establishes "now" — history is the backfill's job, not the live stream's.
        const newest = rows[0];
        if (newest !== undefined) {
          state.watermark = { startTime: newest.startTime.getTime(), traceId: newest.traceId };
        }
        return;
      }
      const watermark = state.watermark;
      const fresh = rows
        .map((row) => ({ row, key: { startTime: row.startTime.getTime(), traceId: row.traceId } }))
        .filter((entry) => isAfter(entry.key, watermark))
        .sort((a, b) => a.key.startTime - b.key.startTime || a.key.traceId.localeCompare(b.key.traceId));
      const now = new Date().toISOString();
      for (const entry of fresh) {
        state.subject.next(this.toEvent(entry.row, now));
        if (isAfter(entry.key, state.watermark)) state.watermark = entry.key;
      }
    } catch (err) {
      // Never surface DB internals; the stream stays open and retries next tick.
      this.logger.warn(`live poll failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      state.polling = false;
    }
  }

  onApplicationShutdown(): void {
    for (const [key, state] of [...this.streams.entries()]) this.stop(key, state);
  }
}
