import { httpResource } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { tracesUrl } from '../../core/api/api-urls';
import type { Paginated, TraceSummary } from '../../core/api/api.types';
import { formatDuration, formatTime, shortId } from '../../shared/format';
import { serviceColor } from '../../shared/service-color';

@Component({
  selector: 'app-traces-page',
  imports: [RouterLink],
  templateUrl: './traces-page.html',
  styleUrl: './traces-page.scss',
})
export class TracesPage {
  readonly service = signal('');
  readonly onlyErrors = signal(false);
  /** Keyset paging: current cursor + a stack of previous ones for "newer". */
  readonly cursor = signal<string | null>(null);
  private readonly prevCursors = signal<readonly (string | null)[]>([]);

  readonly traces = httpResource<Paginated<TraceSummary>>(() =>
    tracesUrl({
      limit: 25,
      cursor: this.cursor(),
      service: this.service() || null,
      status: this.onlyErrors() ? 'error' : null,
    })
  );

  readonly items = computed(() => this.traces.value()?.items ?? []);
  readonly nextCursor = computed(() => this.traces.value()?.nextCursor ?? null);
  readonly hasPrev = computed(() => this.prevCursors().length > 0);

  applyService(value: string): void {
    this.resetPaging();
    this.service.set(value.trim());
  }

  toggleErrors(): void {
    this.resetPaging();
    this.onlyErrors.update((v) => !v);
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
  }

  protected readonly formatDuration = formatDuration;
  protected readonly formatTime = formatTime;
  protected readonly shortId = shortId;
  protected readonly serviceColor = serviceColor;
}
