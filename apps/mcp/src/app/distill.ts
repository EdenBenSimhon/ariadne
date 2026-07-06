import { computeFlowSignature, type TraceDetail } from '@ariadne/graph';

/**
 * Distillation layer (spec §9, security B4): raw spans never reach the LLM.
 * Only graph structure survives — service names, channels, timings, statuses.
 * Metadata is dropped entirely and error strings are sanitized: trace data is
 * untrusted input and the classic attack path is smuggling instructions
 * through it into the model.
 */
export interface DistilledTraceFlow {
  readonly traceId: string;
  readonly rootService: string | null;
  readonly status: 'OK' | 'ERROR';
  readonly durationMs: number;
  readonly spanCount: number;
  readonly orphanCount: number;
  readonly signature: string;
  readonly hops: readonly string[];
  readonly criticalPath: readonly string[];
  readonly errors: readonly { service: string; channel: string; error: string }[];
  readonly cycleCount: number;
}

const ERROR_MAX_CHARS = 200;

/** Cap length and blank control characters — never forward raw text verbatim. */
function sanitize(text: string): string {
  let out = '';
  for (const char of text.slice(0, ERROR_MAX_CHARS)) {
    const code = char.codePointAt(0) ?? 32;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out;
}

export function distillTraceFlow(detail: TraceDetail): DistilledTraceFlow {
  const dag = detail.dag;
  const signature = computeFlowSignature(dag);
  const errors = Object.values(dag.nodes)
    .filter((node) => node.status === 'ERROR')
    .map((node) => ({
      service: node.serviceName,
      channel: node.channel,
      error: node.error !== null ? sanitize(node.error) : 'unknown',
    }));

  return {
    traceId: detail.trace.traceId,
    rootService: detail.trace.rootService,
    status: detail.trace.hasError ? 'ERROR' : 'OK',
    durationMs: detail.trace.durationMs,
    spanCount: detail.trace.spanCount,
    orphanCount: dag.orphanCount,
    signature,
    hops: signature.includes(' | ') ? signature.split(' | ') : [signature],
    criticalPath: detail.criticalPath.spanIds
      .map((spanId) => dag.nodes[spanId])
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .map((node) => `${node.serviceName} (${node.spanKind} ${node.channel})`),
    errors,
    cycleCount: dag.cycles.length,
  };
}
