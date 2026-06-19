import { randomUUID } from 'node:crypto';
import {
  TRACE_HEADERS,
  TRACING_CHANNEL,
  SpanEvent,
  SpanKind,
  SpanStatus,
  Transport,
  injectTraceContext,
  extractTraceContext,
  parseSpanEvent,
  safeParseSpanEvent,
} from '../index';

const TENANT = 'acme-corp';
const TRACE_ID = randomUUID();

/**
 * The spec's canonical worked example (§1): one POST /orders → 6 spans, linked by
 * the parentSpanId chain null → S1 → S2 → S3 → S4 → S5.
 */
const buildSixSpanTrace = (): SpanEvent[] => {
  const hops: Array<{
    kind: SpanKind;
    service: string;
    channel: string;
    transport: Transport;
  }> = [
    { kind: SpanKind.PRODUCER, service: 'order-service', channel: 'orders.created', transport: Transport.KAFKA },
    { kind: SpanKind.CONSUMER, service: 'inventory-service', channel: 'orders.created', transport: Transport.KAFKA },
    { kind: SpanKind.PRODUCER, service: 'inventory-service', channel: 'inventory.reserved', transport: Transport.RABBITMQ },
    { kind: SpanKind.CONSUMER, service: 'payment-service', channel: 'inventory.reserved', transport: Transport.RABBITMQ },
    { kind: SpanKind.PRODUCER, service: 'payment-service', channel: 'payment.completed', transport: Transport.REST },
    { kind: SpanKind.CONSUMER, service: 'order-service', channel: 'payment.completed', transport: Transport.REST },
  ];

  let parentSpanId: string | null = null;
  return hops.map((hop, i) => {
    const spanId = randomUUID();
    const span: SpanEvent = {
      traceId: TRACE_ID,
      spanId,
      parentSpanId,
      tenantId: TENANT,
      serviceName: hop.service,
      spanKind: hop.kind,
      transport: hop.transport,
      channel: hop.channel,
      operationName: `hop-${i + 1}`,
      startTime: new Date(Date.now() + i * 10).toISOString(),
      durationMs: 70,
      status: SpanStatus.OK,
      error: null,
      metadata: { orderId: 'ord-123' },
    };
    parentSpanId = spanId;
    return span;
  });
};

describe('protocol — constants', () => {
  it('exposes the dedicated tracing channel', () => {
    expect(TRACING_CHANNEL).toBe('_tracing');
  });

  it('includes the tenant header for day-one multi-tenancy', () => {
    expect(TRACE_HEADERS.tenantId).toBe('x-tenant-id');
  });
});

describe('protocol — header codec round-trip', () => {
  it('survives inject → extract for every hop', () => {
    for (const span of buildSixSpanTrace()) {
      const headers = injectTraceContext({
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        serviceName: span.serviceName,
        tenantId: span.tenantId,
      });

      expect(headers[TRACE_HEADERS.traceParent]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

      const ctx = extractTraceContext(headers);
      expect(ctx).not.toBeNull();
      expect(ctx).toMatchObject({
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        serviceName: span.serviceName,
        tenantId: span.tenantId,
      });
    }
  });

  it('reads headers case-insensitively', () => {
    const ctx = extractTraceContext({
      'X-Trace-Id': TRACE_ID,
      'X-Span-Id': randomUUID(),
      'X-Service-Name': 'order-service',
      'X-Tenant-Id': TENANT,
    });
    expect(ctx).not.toBeNull();
    expect(ctx?.tenantId).toBe(TENANT);
  });

  it('returns null when required headers are missing', () => {
    expect(extractTraceContext({ [TRACE_HEADERS.traceId]: TRACE_ID })).toBeNull();
  });
});

describe('protocol — span validation', () => {
  it('accepts every well-formed span in the canonical trace', () => {
    for (const span of buildSixSpanTrace()) {
      expect(() => parseSpanEvent(span)).not.toThrow();
      expect(safeParseSpanEvent(span).success).toBe(true);
    }
  });

  it('rejects a malformed span (bad uuid, negative duration)', () => {
    const [span] = buildSixSpanTrace();
    const bad = { ...span, traceId: 'not-a-uuid', durationMs: -5 };
    expect(() => parseSpanEvent(bad)).toThrow();
    expect(safeParseSpanEvent(bad).success).toBe(false);
  });

  it('rejects a span missing tenantId', () => {
    const [span] = buildSixSpanTrace();
    const withoutTenant: Record<string, unknown> = { ...span };
    delete withoutTenant['tenantId'];
    expect(safeParseSpanEvent(withoutTenant).success).toBe(false);
  });
});

describe('protocol — trace reconstruction', () => {
  it('rebuilds the null → S1 → … → S5 chain from a flat, shuffled span list', () => {
    const spans = buildSixSpanTrace();
    const shuffled = [...spans].reverse();

    const byParent = new Map<string | null, SpanEvent[]>();
    for (const s of shuffled) {
      const list = byParent.get(s.parentSpanId) ?? [];
      list.push(s);
      byParent.set(s.parentSpanId, list);
    }

    const order: SpanEvent[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < spans.length; i++) {
      const children: SpanEvent[] = byParent.get(cursor) ?? [];
      expect(children).toHaveLength(1);
      const node: SpanEvent = children[0];
      order.push(node);
      cursor = node.spanId;
    }

    expect(order.map((s) => s.spanId)).toEqual(spans.map((s) => s.spanId));
    expect(order[0].parentSpanId).toBeNull();
    expect(new Set(order.map((s) => s.traceId)).size).toBe(1);
  });
});
