import { httpResource } from '@angular/common/http';
import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  alertEventsUrl,
  anomaliesUrl,
  flowChangesUrl,
  statsTimeseriesUrl,
  statsUrl,
} from '../../core/api/api-urls';
import type {
  AlertEventsResponse,
  AnomaliesResponse,
  FlowsChangesResponse,
  StatsSummary,
  StatsTimeseriesResponse,
} from '../../core/api/api.types';
import { formatDuration } from '../../shared/format';

interface SparkPoint {
  readonly x: number;
  readonly y: number;
  readonly errorY: number;
}

const SPARK_W = 600;
const SPARK_H = 80;

/**
 * The landing view: is the system healthy right now? KPIs and a 24h activity
 * sparkline from /stats, plus the three "what needs attention" feeds —
 * unacknowledged alerts, flow drift and anomalies — each linking to its page.
 */
@Component({
  selector: 'app-overview-page',
  imports: [RouterLink],
  templateUrl: './overview-page.html',
  styleUrl: './overview-page.scss',
})
export class OverviewPage {
  readonly stats = httpResource<StatsSummary>(() => statsUrl());
  readonly timeseries = httpResource<StatsTimeseriesResponse>(() => statsTimeseriesUrl(30));
  readonly alertEvents = httpResource<AlertEventsResponse>(() => alertEventsUrl(10));
  readonly flowChanges = httpResource<FlowsChangesResponse>(() => flowChangesUrl(24));
  readonly anomalies = httpResource<AnomaliesResponse>(() => anomaliesUrl());

  readonly openAlerts = computed(() =>
    (this.alertEvents.value()?.items ?? []).filter((event) => !event.acknowledged).slice(0, 5)
  );
  readonly changes = computed(() => (this.flowChanges.value()?.changes ?? []).slice(0, 4));
  readonly anomalyItems = computed(() =>
    (this.anomalies.value()?.anomalies ?? []).slice(0, 4)
  );

  readonly sparkWidth = SPARK_W;
  readonly sparkHeight = SPARK_H;

  /** Bucket counts scaled into an SVG viewBox; error share drawn as a red overlay. */
  readonly sparkPoints = computed<readonly SparkPoint[]>(() => {
    const buckets = this.timeseries.value()?.buckets ?? [];
    if (buckets.length === 0) return [];
    const max = Math.max(...buckets.map((b) => b.traceCount), 1);
    const step = SPARK_W / Math.max(buckets.length, 1);
    return buckets.map((bucket, i) => ({
      x: Math.round(i * step + step / 2),
      y: Math.round(SPARK_H - (bucket.traceCount / max) * (SPARK_H - 6)) - 2,
      errorY: Math.round(SPARK_H - (bucket.errorTraceCount / max) * (SPARK_H - 6)) - 2,
    }));
  });

  readonly sparkLine = computed(() =>
    this.sparkPoints()
      .map((p) => `${p.x},${p.y}`)
      .join(' ')
  );

  errorRatePct(): string {
    const rate = this.stats.value()?.errorRate ?? 0;
    return `${(rate * 100).toFixed(1)}%`;
  }

  p95(): string {
    const p95 = this.stats.value()?.p95DurationMs;
    return p95 !== null && p95 !== undefined ? formatDuration(p95) : '—';
  }

  protected readonly formatDuration = formatDuration;
}
