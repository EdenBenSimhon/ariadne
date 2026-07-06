import { Component, computed, input } from '@angular/core';
import type { TraceDag } from '@ariadne/graph';
import { formatDuration } from '../../../shared/format';
import { serviceColor } from '../../../shared/service-color';
import { computeAxisTicks, computeTimelineRows, type TimelineRow } from './timeline-layout';

/** Gantt-style span bars — plain divs, no D3 needed for 1-D percentages. */
@Component({
  selector: 'app-timeline',
  templateUrl: './timeline.html',
  styleUrl: './timeline.scss',
})
export class Timeline {
  readonly dag = input.required<TraceDag>();

  protected readonly rows = computed(() => computeTimelineRows(this.dag()));
  protected readonly ticks = computed(() => computeAxisTicks(this.dag().durationMs));

  protected readonly serviceColor = serviceColor;
  protected readonly formatDuration = formatDuration;

  protected tooltip(row: TimelineRow): string {
    const node = row.node;
    const suffix = node.error !== null ? ` · ${node.error}` : '';
    return `${node.operationName} · ${formatDuration(node.durationMs)} · ${node.channel}${suffix}`;
  }
}
