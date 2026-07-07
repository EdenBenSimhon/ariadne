import { Component, computed, input, signal } from '@angular/core';
import type { TraceDag } from '@ariadne/graph';
import type { Metadata } from '@ariadne/protocol';
import { formatDuration } from '../../../shared/format';
import { serviceColor } from '../../../shared/service-color';
import { computeAxisTicks, computeTimelineRows, type TimelineRow } from './timeline-layout';

interface HoverState {
  readonly row: TimelineRow;
  readonly x: number;
  readonly y: number;
}

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

  protected readonly hover = signal<HoverState | null>(null);

  protected readonly serviceColor = serviceColor;
  protected readonly formatDuration = formatDuration;

  protected showTip(row: TimelineRow, event: MouseEvent): void {
    this.hover.set({ row, x: event.clientX, y: event.clientY });
  }

  protected moveTip(event: MouseEvent): void {
    const current = this.hover();
    if (current === null) return;
    this.hover.set({ ...current, x: event.clientX, y: event.clientY });
  }

  protected hideTip(): void {
    this.hover.set(null);
  }

  /** Allowlisted message payload as key/value rows for the hover card. */
  protected metaEntries(metadata: Metadata | null): readonly [string, string][] {
    if (!metadata) return [];
    return Object.entries(metadata).map(([key, value]) => [key, String(value)]);
  }
}
