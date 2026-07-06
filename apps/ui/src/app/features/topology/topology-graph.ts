import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  untracked,
  viewChild,
  type ElementRef,
} from '@angular/core';
import type { TopologyEdge, TopologyGraph as TopologyGraphData, TopologyNode } from '@ariadne/graph';
import { drag } from 'd3-drag';
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { select } from 'd3-selection';
import { serviceColor } from '../../shared/service-color';

interface SimNode extends SimulationNodeDatum, TopologyNode {
  id: string;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  edge: TopologyEdge;
}

/**
 * The one D3 island. Rules:
 * 1. Nothing inside the <svg> uses Angular template syntax — D3 owns it.
 * 2. Every render rebuilds all selections (no stale handles) and stops the
 *    previous simulation.
 * 3. Tick/drag handlers only write attributes — no Angular bindings, so no
 *    change detection is needed (zoneless-safe). Anything crossing back into
 *    Angular goes through the `serviceSelected` output.
 */
@Component({
  selector: 'app-topology-graph',
  template: `<svg #svg class="topo"></svg>`,
  styles: `
    :host {
      display: block;
      height: 100%;
    }
  `,
})
export class TopologyGraph {
  readonly data = input.required<TopologyGraphData>();
  readonly serviceSelected = output<string>();

  private readonly svgRef = viewChild<ElementRef<SVGSVGElement>>('svg');
  private simulation: Simulation<SimNode, SimLink> | null = null;

  constructor() {
    effect(() => {
      const svg = this.svgRef();
      const graph = this.data();
      if (svg === undefined) return;
      untracked(() => this.render(svg.nativeElement, graph));
    });
    inject(DestroyRef).onDestroy(() => this.simulation?.stop());
  }

  private render(element: SVGSVGElement, graph: TopologyGraphData): void {
    this.simulation?.stop();
    const svg = select(element);
    svg.selectAll('*').remove();

    const width = element.clientWidth || 900;
    const height = element.clientHeight || 600;
    const nodes: SimNode[] = graph.nodes.map((node) => ({ ...node, id: node.service }));
    const links: SimLink[] = graph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      edge,
    }));

    this.simulation = forceSimulation(nodes)
      .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(140))
      .force('charge', forceManyBody().strength(-350))
      .force('center', forceCenter(width / 2, height / 2));

    const link = svg
      .append('g')
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .join('line')
      .attr('class', (l) => (l.edge.errorCount > 0 ? 'edge error' : 'edge'))
      .attr('stroke-width', (l) => 1 + Math.log1p(l.edge.count));
    link.append('title').text((l) => `${l.edge.channel} · ${l.edge.count}× · avg ${l.edge.avgDurationMs}ms`);

    const node = svg
      .append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .call(
        drag<SVGGElement, SimNode>()
          .on('start', (_event, d) => {
            this.simulation?.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (_event, d) => {
            this.simulation?.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on('click', (_event, d) => this.serviceSelected.emit(d.id));

    node
      .append('circle')
      .attr('r', (d) => 10 + Math.log1p(d.spanCount) * 3)
      .attr('fill', (d) => resolveCssVar(element, serviceColor(d.id)))
      .attr('stroke', (d) => (d.errorCount > 0 ? 'var(--error)' : 'var(--bg)'));
    node.append('text').text((d) => d.id).attr('dy', -18);
    node.append('title').text((d) => `${d.spanCount} spans · ${d.errorCount} errors`);

    this.simulation.on('tick', () => {
      link
        .attr('x1', (l) => (l.source as SimNode).x ?? 0)
        .attr('y1', (l) => (l.source as SimNode).y ?? 0)
        .attr('x2', (l) => (l.target as SimNode).x ?? 0)
        .attr('y2', (l) => (l.target as SimNode).y ?? 0);
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });
  }
}

/** SVG fill needs a concrete color — resolve `var(--svc-N)` against the element. */
function resolveCssVar(element: Element, cssVar: string): string {
  const match = /^var\((--[a-z0-9-]+)\)$/.exec(cssVar);
  if (match === null || match[1] === undefined) return cssVar;
  const value = getComputedStyle(element).getPropertyValue(match[1]).trim();
  return value.length > 0 ? value : '#58a6ff';
}
