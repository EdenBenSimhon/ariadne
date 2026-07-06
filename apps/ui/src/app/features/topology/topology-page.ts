import { httpResource } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { topologyUrl } from '../../core/api/api-urls';
import type { TopologyGraph as TopologyGraphData } from '../../core/api/api.types';
import { TopologyGraph } from './topology-graph';

@Component({
  selector: 'app-topology-page',
  imports: [TopologyGraph],
  template: `
    @if (topology.isLoading()) {
      <div class="state-note">loading topology…</div>
    } @else if (topology.error()) {
      <div class="state-note">failed to load topology — is the API running?</div>
    } @else if (topology.value(); as graph) {
      @if (graph.nodes.length === 0) {
        <div class="state-note">no services observed in this window</div>
      } @else {
        @if (graph.truncated) {
          <div class="state-note">⚠ partial picture — the span window was truncated</div>
        }
        @if (graph.cycles.length > 0) {
          <div class="state-note dim">
            {{ graph.cycles.length }} service loop(s) observed — expected in event choreography
          </div>
        }
        <div class="graph-host panel">
          <app-topology-graph [data]="graph" (serviceSelected)="openService($event)" />
        </div>
      }
    }
  `,
  styles: `
    .graph-host {
      height: calc(100vh - 180px);
    }
  `,
})
export class TopologyPage {
  readonly topology = httpResource<TopologyGraphData>(() => topologyUrl());
  private readonly router = inject(Router);

  openService(service: string): void {
    void this.router.navigate(['/traces'], { queryParams: { service } });
  }
}
