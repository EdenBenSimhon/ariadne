import { httpResource } from '@angular/common/http';
import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { anomaliesUrl, flowChangesUrl, flowsUrl } from '../../core/api/api-urls';
import type {
  AnomaliesResponse,
  FlowsChangesResponse,
  FlowsResponse,
} from '../../core/api/api.types';
import { formatDuration, shortId } from '../../shared/format';
import { serviceColor } from '../../shared/service-color';

/**
 * Business flows discovered from the observed traces — the exact same
 * /api/flows + /api/anomalies data the MCP agent reasons over, so what the
 * AI says and what you see here always match.
 */
@Component({
  selector: 'app-flows-page',
  imports: [RouterLink],
  templateUrl: './flows-page.html',
  styleUrl: './flows-page.scss',
})
export class FlowsPage {
  readonly changeWindowHours = signal(24);

  readonly flows = httpResource<FlowsResponse>(() => flowsUrl());
  readonly anomalies = httpResource<AnomaliesResponse>(() => anomaliesUrl());
  readonly flowChanges = httpResource<FlowsChangesResponse>(() =>
    flowChangesUrl(this.changeWindowHours())
  );

  protected readonly flowItems = computed(() => this.flows.value()?.flows ?? []);
  protected readonly anomalyItems = computed(() => this.anomalies.value()?.anomalies ?? []);
  protected readonly changeItems = computed(() => this.flowChanges.value()?.changes ?? []);

  setChangeWindow(value: string): void {
    this.changeWindowHours.set(Number(value) || 24);
  }

  protected readonly formatDuration = formatDuration;
  protected readonly shortId = shortId;
  protected readonly serviceColor = serviceColor;
}
