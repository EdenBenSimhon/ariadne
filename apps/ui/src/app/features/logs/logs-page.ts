import { httpResource } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { servicesUrl, spansUrl } from '../../core/api/api-urls';
import type { Paginated, ServiceSummary, SpanLogEntry } from '../../core/api/api.types';
import { formatDuration, formatTime, shortId } from '../../shared/format';
import { serviceColor } from '../../shared/service-color';

const RANGES = [
  { label: 'last 15m', minutes: 15 },
  { label: 'last 1h', minutes: 60 },
  { label: 'last 6h', minutes: 360 },
  { label: 'last 24h', minutes: 1_440 },
  { label: 'last 7d', minutes: 10_080 },
] as const;

/**
 * Logger-style search over raw spans: free text + structured filters, the
 * view an engineer greps when they already know WHAT they are looking for.
 * (For "what changed?" questions the Flows page and the agent are the tools.)
 */
@Component({
  selector: 'app-logs-page',
  imports: [RouterLink],
  templateUrl: './logs-page.html',
  styleUrl: './logs-page.scss',
})
export class LogsPage {
  protected readonly ranges = RANGES;

  readonly q = signal('');
  readonly service = signal('');
  readonly status = signal<'' | 'OK' | 'ERROR'>('');
  readonly transport = signal('');
  readonly rangeMinutes = signal<number>(1_440);
  readonly minDurationMs = signal<number | null>(null);
  readonly cursor = signal<string | null>(null);
  private readonly prevCursors = signal<readonly (string | null)[]>([]);
  /** Expanded rows, keyed by spanId (metadata + error detail). */
  readonly expanded = signal<ReadonlySet<string>>(new Set());

  readonly logs = httpResource<Paginated<SpanLogEntry>>(() =>
    spansUrl({
      limit: 50,
      cursor: this.cursor(),
      q: this.q() || null,
      service: this.service() || null,
      status: this.status() || null,
      transport: this.transport() || null,
      minDurationMs: this.minDurationMs(),
      from: new Date(Date.now() - this.rangeMinutes() * 60_000).toISOString(),
    })
  );

  readonly services = httpResource<ServiceSummary[]>(() => servicesUrl());

  readonly items = computed(() => this.logs.value()?.items ?? []);
  readonly nextCursor = computed(() => this.logs.value()?.nextCursor ?? null);
  readonly hasPrev = computed(() => this.prevCursors().length > 0);
  readonly serviceNames = computed(() =>
    (this.services.value() ?? []).map((entry) => entry.serviceName)
  );

  applyQuery(value: string): void {
    this.resetPaging();
    this.q.set(value.trim());
  }

  setService(value: string): void {
    this.resetPaging();
    this.service.set(value);
  }

  setStatus(value: string): void {
    this.resetPaging();
    this.status.set(value === 'OK' || value === 'ERROR' ? value : '');
  }

  setTransport(value: string): void {
    this.resetPaging();
    this.transport.set(value);
  }

  setRange(value: string): void {
    this.resetPaging();
    this.rangeMinutes.set(Number(value) || 1_440);
  }

  setMinDuration(value: string): void {
    this.resetPaging();
    const parsed = Number(value);
    this.minDurationMs.set(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null);
  }

  toggleRow(spanId: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }

  metadataEntries(entry: SpanLogEntry): readonly [string, string][] {
    return Object.entries(entry.metadata ?? {}).map(([key, value]) => [key, String(value)]);
  }

  next(): void {
    const cursor = this.nextCursor();
    if (cursor === null) return;
    this.prevCursors.update((stack) => [...stack, this.cursor()]);
    this.cursor.set(cursor);
  }

  prev(): void {
    const stack = this.prevCursors();
    this.cursor.set(stack[stack.length - 1] ?? null);
    this.prevCursors.set(stack.slice(0, -1));
  }

  private resetPaging(): void {
    this.cursor.set(null);
    this.prevCursors.set([]);
    this.expanded.set(new Set());
  }

  protected readonly formatDuration = formatDuration;
  protected readonly formatTime = formatTime;
  protected readonly shortId = shortId;
  protected readonly serviceColor = serviceColor;
}
