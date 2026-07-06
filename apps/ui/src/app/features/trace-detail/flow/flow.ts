import { Component, computed, input } from '@angular/core';
import type { TraceDag } from '@ariadne/graph';
import { formatDuration } from '../../../shared/format';
import { serviceColor } from '../../../shared/service-color';
import { DEFAULT_DAG_LAYOUT, layoutDag } from './dag-layout';

/** Trace DAG rendered as Angular-templated SVG — no DOM manipulation, zoneless-safe. */
@Component({
  selector: 'app-flow',
  templateUrl: './flow.html',
  styleUrl: './flow.scss',
})
export class Flow {
  readonly dag = input.required<TraceDag>();

  protected readonly layout = computed(() => layoutDag(this.dag()));
  protected readonly opts = DEFAULT_DAG_LAYOUT;
  protected readonly serviceColor = serviceColor;
  protected readonly formatDuration = formatDuration;

  protected viewBox(): string {
    const layout = this.layout();
    return `-10 -10 ${layout.width + 20} ${layout.height + 20}`;
  }
}
