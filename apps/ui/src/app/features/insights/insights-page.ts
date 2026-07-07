import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { insightUrl, insightsUrl } from '../../core/api/api-urls';
import type { InsightsResponse } from '../../core/api/api.types';
import { formatTime, shortId } from '../../shared/format';

/**
 * Persisted conclusions: everything the Ask agent (or a teammate) decided was
 * worth keeping — flow changes, error patterns, anomalies — with the trace
 * ids that evidence each one. The system's long-term memory about itself.
 */
@Component({
  selector: 'app-insights-page',
  imports: [RouterLink],
  templateUrl: './insights-page.html',
  styleUrl: './insights-page.scss',
})
export class InsightsPage {
  private readonly http = inject(HttpClient);

  readonly insights = httpResource<InsightsResponse>(() => insightsUrl());
  readonly items = computed(() => this.insights.value()?.items ?? []);
  readonly deleting = signal<string | null>(null);

  remove(insightId: string): void {
    this.deleting.set(insightId);
    this.http.delete(insightUrl(insightId)).subscribe({
      next: () => {
        this.deleting.set(null);
        this.insights.reload();
      },
      error: () => this.deleting.set(null),
    });
  }

  protected readonly formatTime = formatTime;
  protected readonly shortId = shortId;
}
