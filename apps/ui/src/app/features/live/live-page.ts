import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Subscription } from 'rxjs';
import { liveEvents, type LiveStreamMessage } from '../../core/api/live-events.client';
import type { TraceLiveEvent } from '../../core/api/api.types';
import { DEFAULT_TENANT } from '../../core/api/tenant.interceptor';
import { formatDuration, formatTime, shortId } from '../../shared/format';
import { serviceColor } from '../../shared/service-color';

type ConnStatus = 'connecting' | 'live' | 'paused' | 'error';
const MAX_EVENTS = 300;
const CLEARED_AT_KEY = 'live:clearedAt';

/**
 * Realtime activity over SSE. The transport is an RxJS Observable
 * (`liveEvents`); this component bridges it into signals — the idiomatic
 * zoneless pattern: push at the edge, signals for state and rendering.
 * Same feed the MCP `get_recent_activity` tool reads, so the AI and the
 * screen agree on "what just happened".
 */
@Component({
  selector: 'app-live-page',
  imports: [RouterLink],
  templateUrl: './live-page.html',
  styleUrl: './live-page.scss',
})
export class LivePage {
  private readonly destroyRef = inject(DestroyRef);
  private subscription: Subscription | null = null;

  protected readonly events = signal<TraceLiveEvent[]>([]);
  protected readonly status = signal<ConnStatus>('connecting');
  protected readonly errorsOnly = signal(false);
  protected readonly lastBeat = signal<string | null>(null);

  /**
   * Watermark set by "Clear": events at/older than this are suppressed, so a
   * clear survives a refresh (the SSE backfill would otherwise replay them).
   * Persisted per-browser; new live events (later `at`) still come through.
   */
  private clearedAt: string | null = readClearedAt();

  protected readonly visible = computed(() => {
    const list = this.errorsOnly()
      ? this.events().filter((event) => event.trace.hasError)
      : this.events();
    // Newest first, regardless of SSE arrival / backfill order.
    return [...list].sort((a, b) => b.at.localeCompare(a.at));
  });
  protected readonly total = computed(() => this.events().length);
  protected readonly errorCount = computed(() => this.events().filter((event) => event.trace.hasError).length);

  protected readonly formatDuration = formatDuration;
  protected readonly formatTime = formatTime;
  protected readonly shortId = shortId;
  protected readonly serviceColor = serviceColor;

  constructor() {
    this.connect();
    this.destroyRef.onDestroy(() => this.subscription?.unsubscribe());
  }

  private connect(): void {
    this.status.set('connecting');
    this.subscription = liveEvents({ tenantId: DEFAULT_TENANT, backfill: 25 }).subscribe((message) =>
      this.onMessage(message)
    );
  }

  private onMessage(message: LiveStreamMessage): void {
    if (message.kind === 'status') {
      if (this.status() !== 'paused') this.status.set(message.status === 'open' ? 'live' : 'error');
      return;
    }
    if (message.kind === 'heartbeat') {
      this.lastBeat.set(message.at);
      if (this.status() !== 'paused') this.status.set('live');
      return;
    }
    if (this.clearedAt !== null && message.at <= this.clearedAt) return;
    this.events.update((list) => [message, ...list].slice(0, MAX_EVENTS));
    if (this.status() !== 'paused') this.status.set('live');
  }

  protected togglePause(): void {
    if (this.status() === 'paused') {
      this.connect();
      return;
    }
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.status.set('paused');
  }

  protected clear(): void {
    // Watermark = newest event we currently hold (fallback to now), so the
    // backfill can't bring these back after a refresh.
    const newest = this.events().reduce<string | null>(
      (max, event) => (max === null || event.at > max ? event.at : max),
      null
    );
    this.clearedAt = newest ?? new Date().toISOString();
    writeClearedAt(this.clearedAt);
    this.events.set([]);
  }

  protected toggleErrorsOnly(): void {
    this.errorsOnly.update((value) => !value);
  }
}

function readClearedAt(): string | null {
  try {
    return localStorage.getItem(CLEARED_AT_KEY);
  } catch {
    return null;
  }
}

function writeClearedAt(at: string): void {
  try {
    localStorage.setItem(CLEARED_AT_KEY, at);
  } catch {
    // storage unavailable (private mode / quota) — clear stays session-only
  }
}
