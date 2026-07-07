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
const METADATA_VALUE_MAX_CHARS = 120;

/** Cap length and blank control characters — never forward raw text verbatim. */
export function sanitize(text: string, maxChars = ERROR_MAX_CHARS): string {
  let out = '';
  for (const char of text.slice(0, maxChars)) {
    const code = char.codePointAt(0) ?? 32;
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out;
}

/**
 * Metadata reaching the LLM is the one deliberate relaxation of "structure
 * only": values were already allowlist-redacted at the SDK (B1), and here
 * every key and value is additionally sanitized and size-capped, so a
 * metadata field can carry business context ("orderId", "region") but not a
 * paragraph of smuggled instructions.
 */
export function sanitizeMetadata(
  metadata: Readonly<Record<string, string | number | boolean | null>> | null
): Record<string, string> | null {
  if (metadata === null) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    out[sanitize(key, 64)] = sanitize(String(value), METADATA_VALUE_MAX_CHARS);
  }
  return out;
}

/** One span as a distilled, LLM-safe log line (the search_logs row shape). */
export interface DistilledLogLine {
  readonly time: string;
  readonly service: string;
  readonly kind: string;
  readonly transport: string;
  readonly channel: string;
  readonly operation: string;
  readonly status: 'OK' | 'ERROR';
  readonly durationMs: number;
  readonly error: string | null;
  readonly metadata: Record<string, string> | null;
  readonly traceId: string;
}

export interface ApiSpanLogEntry {
  readonly traceId: string;
  readonly serviceName: string;
  readonly spanKind: string;
  readonly transport: string;
  readonly channel: string;
  readonly operationName: string;
  readonly startTime: string;
  readonly durationMs: number;
  readonly status: 'OK' | 'ERROR';
  readonly error: string | null;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>> | null;
}

export function distillLogLine(entry: ApiSpanLogEntry): DistilledLogLine {
  return {
    time: entry.startTime,
    service: sanitize(entry.serviceName, 128),
    kind: entry.spanKind,
    transport: entry.transport,
    channel: sanitize(entry.channel, 128),
    operation: sanitize(entry.operationName, 128),
    status: entry.status,
    durationMs: entry.durationMs,
    error: entry.error !== null ? sanitize(entry.error) : null,
    metadata: sanitizeMetadata(entry.metadata),
    traceId: entry.traceId,
  };
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
