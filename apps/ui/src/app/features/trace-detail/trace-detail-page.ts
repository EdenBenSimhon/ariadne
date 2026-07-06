import { httpResource } from '@angular/common/http';
import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { traceUrl } from '../../core/api/api-urls';
import type { TraceDetail } from '../../core/api/api.types';
import { formatDuration, formatTime, shortId } from '../../shared/format';
import { Flow } from './flow/flow';
import { Timeline } from './timeline/timeline';

@Component({
  selector: 'app-trace-detail-page',
  imports: [RouterLink, Timeline, Flow],
  templateUrl: './trace-detail-page.html',
  styleUrl: './trace-detail-page.scss',
})
export class TraceDetailPage {
  /** Bound from the :traceId route param (withComponentInputBinding). */
  readonly traceId = input.required<string>();

  readonly view = signal<'timeline' | 'flow'>('timeline');

  readonly detail = httpResource<TraceDetail>(() => traceUrl(this.traceId()));

  protected readonly dag = computed(() => this.detail.value()?.dag ?? null);
  protected readonly trace = computed(() => this.detail.value()?.trace ?? null);
  protected readonly criticalPathMs = computed(
    () => this.detail.value()?.criticalPath.durationMs ?? 0
  );

  protected readonly formatDuration = formatDuration;
  protected readonly formatTime = formatTime;
  protected readonly shortId = shortId;
}
