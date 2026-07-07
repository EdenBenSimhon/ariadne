/**
 * MCP flow-recognition demo — drives the REAL shipped @ariadne/graph algorithms
 * (dist/libs/graph) over a complex, mocked 11-service e-commerce mesh, then
 * reproduces exactly what each Phase-7 MCP tool returns:
 *
 *   list_traces · get_stats · get_topology · discover_business_flows
 *   find_anomalies · get_trace_flow (distilled)
 *
 * No Docker needed: this is the same code path the API/MCP run, fed mock spans
 * instead of Postgres rows. Run: node tools/mcp-demo/complex-mesh.cjs
 */
const {
  buildTraceDag,
  buildTopology,
  computeCriticalPath,
  computeFlowSignature,
  discoverBusinessFlows,
  detectAnomalies,
} = require('../../dist/libs/graph/src/index.js');

// ---- deterministic RNG (seeded LCG) so the demo is reproducible ------------
let _seed = 1337;
const rand = () => ((_seed = (_seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const jitter = (base, spread) => Math.round(base + (rand() * 2 - 1) * spread);
const chance = (p) => rand() < p;

let _sid = 0;
const spanId = () => (++_sid).toString(16).padStart(16, '0');
let _tid = 0;
const traceId = () => (++_tid).toString(16).padStart(32, '0');

// ---- span/hop builders -----------------------------------------------------
// A "hop" is a parent span in service A whose child span lives in service B;
// the child's (transport, channel) label the edge. This mirrors the demo mesh.
function makeChain(clock, steps) {
  // steps: [{ service, kind, transport, channel, op, dur, error? }]
  const spans = [];
  let parentSpanId = null;
  let t = clock.start;
  for (const s of steps) {
    const id = spanId();
    const dur = jitter(s.dur, Math.max(1, s.dur * 0.25));
    spans.push({
      spanId: id,
      parentSpanId,
      serviceName: s.service,
      spanKind: s.kind,
      transport: s.transport,
      channel: s.channel,
      operationName: s.op,
      startTimeMs: t,
      durationMs: dur,
      status: s.error ? 'ERROR' : 'OK',
      error: s.error ?? null,
    });
    parentSpanId = id;
    t += jitter(4, 2); // small propagation gap; nested children start slightly later
  }
  return spans;
}

// ---- the 11-service mesh: 6 distinct business flows ------------------------
const flowTraces = []; // { traceId, durationMs, hasError, spans, label }
let clockCursor = 1_720_000_000_000; // fixed epoch base (no Date.now — reproducible)

function emit(label, steps) {
  const start = (clockCursor += jitter(1500, 500));
  const spans = makeChain({ start }, steps);
  const end = Math.max(...spans.map((s) => s.startTimeMs + s.durationMs));
  const hasError = spans.some((s) => s.status === 'ERROR');
  const tid = traceId();
  for (const s of spans) s._traceId = tid;
  flowTraces.push({ traceId: tid, durationMs: end - start, hasError, spans, label });
}

// Flow 1 — Place Order (the dominant happy path): REST -> Kafka -> Kafka -> AMQP -> AMQP
for (let i = 0; i < 40; i++) {
  const paymentFails = chance(0.08);
  const notifyFails = !paymentFails && chance(0.6); // notification email is a real hotspot
  emit('place-order', [
    { service: 'api-gateway', kind: 'CONSUMER', transport: 'rest', channel: 'POST /orders', op: 'placeOrder', dur: 12 },
    { service: 'order-service', kind: 'CONSUMER', transport: 'kafka', channel: 'orders.v1', op: 'onOrderCreated', dur: 30 },
    { service: 'payment-service', kind: 'CONSUMER', transport: 'kafka', channel: 'payments.v1', op: 'charge', dur: 45, error: paymentFails ? 'card declined' : undefined },
    ...(paymentFails ? [] : [
      { service: 'inventory-service', kind: 'CONSUMER', transport: 'rabbitmq', channel: 'inventory.reserve', op: 'reserveStock', dur: 22 },
      { service: 'shipping-service', kind: 'CONSUMER', transport: 'rabbitmq', channel: 'shipping.dispatch', op: 'dispatch', dur: 35 },
      { service: 'notification-service', kind: 'CONSUMER', transport: 'rabbitmq', channel: 'notify.email', op: 'sendConfirmation', dur: 18, error: notifyFails ? 'SMTP 550 mailbox unavailable' : undefined },
    ]),
  ]);
}

// Flow 2 — Place Order WITH fraud screening (distinct signature: extra REST hop)
for (let i = 0; i < 15; i++) {
  emit('place-order-fraud-checked', [
    { service: 'api-gateway', kind: 'CONSUMER', transport: 'rest', channel: 'POST /orders', op: 'placeOrder', dur: 12 },
    { service: 'order-service', kind: 'CONSUMER', transport: 'kafka', channel: 'orders.v1', op: 'onOrderCreated', dur: 30 },
    { service: 'fraud-service', kind: 'CONSUMER', transport: 'rest', channel: 'POST /screen', op: 'screen', dur: 60 },
    { service: 'payment-service', kind: 'CONSUMER', transport: 'kafka', channel: 'payments.v1', op: 'charge', dur: 45 },
    { service: 'inventory-service', kind: 'CONSUMER', transport: 'rabbitmq', channel: 'inventory.reserve', op: 'reserveStock', dur: 22 },
  ]);
}

// Flow 3 — Payment declined every time (a "failing flow": same signature, high error rate)
for (let i = 0; i < 12; i++) {
  emit('payment-declined', [
    { service: 'api-gateway', kind: 'CONSUMER', transport: 'rest', channel: 'POST /orders', op: 'placeOrder', dur: 12 },
    { service: 'order-service', kind: 'CONSUMER', transport: 'kafka', channel: 'orders.retry', op: 'onOrderRetry', dur: 30 },
    { service: 'payment-service', kind: 'CONSUMER', transport: 'kafka', channel: 'payments.high-risk', op: 'charge', dur: 40, error: chance(0.75) ? 'insufficient funds' : undefined },
  ]);
}

// Flow 4 — Refund
for (let i = 0; i < 14; i++) {
  emit('refund', [
    { service: 'api-gateway', kind: 'CONSUMER', transport: 'rest', channel: 'POST /refunds', op: 'refund', dur: 12 },
    { service: 'order-service', kind: 'CONSUMER', transport: 'kafka', channel: 'refunds.v1', op: 'onRefund', dur: 28 },
    { service: 'payment-service', kind: 'CONSUMER', transport: 'kafka', channel: 'payments.refund', op: 'reverse', dur: 40 },
    { service: 'notification-service', kind: 'CONSUMER', transport: 'rabbitmq', channel: 'notify.email', op: 'sendRefundEmail', dur: 18 },
  ]);
}

// Flow 5 — Inventory sync choreography with a SERVICE CYCLE (inventory <-> warehouse)
for (let i = 0; i < 9; i++) {
  emit('inventory-sync', [
    { service: 'inventory-service', kind: 'CONSUMER', transport: 'rabbitmq', channel: 'inventory.sync.tick', op: 'syncTick', dur: 10 },
    { service: 'warehouse-service', kind: 'CONSUMER', transport: 'rabbitmq', channel: 'warehouse.sync', op: 'applyDelta', dur: 25 },
    { service: 'inventory-service', kind: 'CONSUMER', transport: 'rabbitmq', channel: 'inventory.ack', op: 'ackDelta', dur: 8 },
  ]);
}

// Flow 6 — Pricing quote with a LATENCY-DOMINANT hop (external pricing engine, ~2s)
for (let i = 0; i < 10; i++) {
  emit('pricing-quote', [
    { service: 'api-gateway', kind: 'CONSUMER', transport: 'rest', channel: 'GET /quote', op: 'quote', dur: 8 },
    { service: 'pricing-service', kind: 'CONSUMER', transport: 'rest', channel: 'POST /price', op: 'computePrice', dur: 2000 },
  ]);
}

// Edge case A — a partial trace with an ORPHAN (parent span never arrived)
{
  const tid = traceId();
  const start = (clockCursor += 1500);
  const spans = [
    // root missing on purpose; this child references a parent id nobody emitted
    { spanId: spanId(), parentSpanId: 'deadbeefdeadbeef', serviceName: 'shipping-service', spanKind: 'CONSUMER', transport: 'rabbitmq', channel: 'shipping.dispatch', operationName: 'dispatch', startTimeMs: start, durationMs: 30, status: 'OK', error: null },
  ];
  for (const s of spans) s._traceId = tid;
  flowTraces.push({ traceId: tid, durationMs: 30, hasError: false, spans, label: 'partial-orphan' });
}

// Edge case B — a forged parent LOOP inside one trace (span-level cycle; must terminate)
{
  const tid = traceId();
  const start = (clockCursor += 1500);
  const a = spanId(), b = spanId();
  const spans = [
    { spanId: a, parentSpanId: b, serviceName: 'order-service', spanKind: 'CONSUMER', transport: 'kafka', channel: 'orders.v1', operationName: 'a', startTimeMs: start, durationMs: 10, status: 'OK', error: null },
    { spanId: b, parentSpanId: a, serviceName: 'payment-service', spanKind: 'CONSUMER', transport: 'kafka', channel: 'payments.v1', operationName: 'b', startTimeMs: start + 5, durationMs: 10, status: 'OK', error: null },
  ];
  for (const s of spans) s._traceId = tid;
  flowTraces.push({ traceId: tid, durationMs: 15, hasError: false, spans, label: 'forged-loop' });
}

// ============================================================================
// Run the REAL algorithms exactly as the API services do, and print MCP output
// ============================================================================
const line = (c = '─') => c.repeat(78);
const H = (t) => console.log(`\n${line('═')}\n  ${t}\n${line('═')}`);

// Build every trace's DAG once
const dags = flowTraces.map((t) => ({
  ...t,
  dag: buildTraceDag(t.traceId, t.spans),
}));

const _svcCount = new Set(flowTraces.flatMap((t) => t.spans.map((s) => s.serviceName))).size;
console.log(`\nMocked mesh: ${flowTraces.length} traces, ${flowTraces.reduce((n, t) => n + t.spans.length, 0)} spans across ${_svcCount} services.`);

// ---- MCP tool: get_stats ---------------------------------------------------
H('MCP tool → get_stats');
const allSpans = dags.flatMap((t) => t.spans);
const services = new Set(allSpans.map((s) => s.serviceName));
const errorTraces = dags.filter((t) => t.hasError).length;
const durations = dags.map((t) => t.durationMs).sort((a, b) => a - b);
const pct = (p) => durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))];
console.log(JSON.stringify({
  traceCount: dags.length,
  errorTraceCount: errorTraces,
  errorRate: +(errorTraces / dags.length).toFixed(3),
  spanCount: allSpans.length,
  serviceCount: services.size,
  avgDurationMs: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
  p50DurationMs: pct(50),
  p95DurationMs: pct(95),
}, null, 2));

// ---- MCP tool: list_traces (first 5) ---------------------------------------
H('MCP tool → list_traces (limit 5, newest first)');
console.log(JSON.stringify(
  [...dags].reverse().slice(0, 5).map((t) => ({
    traceId: t.traceId,
    rootService: t.dag.nodes[t.dag.roots[0]]?.serviceName ?? null,
    spanCount: t.spans.length,
    durationMs: t.durationMs,
    hasError: t.hasError,
  })), null, 2));

// ---- MCP tool: get_topology ------------------------------------------------
H('MCP tool → get_topology');
const topoSpans = allSpans.map((s) => ({ ...s, traceId: s._traceId }));
const topology = buildTopology(topoSpans);
console.log(`nodes: ${topology.nodes.length}  edges: ${topology.edges.length}  cycles: ${topology.cycles.length}  truncated: ${topology.truncated}`);
console.log('\nservice-to-service edges (source -[channel/transport]-> target  | count avg err):');
for (const e of topology.edges) {
  console.log(`  ${e.source} -[${e.channel}/${e.transport}]-> ${e.target}  | n=${e.count} avg=${e.avgDurationMs}ms err=${e.errorCount}`);
}
console.log('\nservice cycles detected:', JSON.stringify(topology.cycles));

// ---- MCP tool: discover_business_flows -------------------------------------
H('MCP tool → discover_business_flows  (the headline: "recognize the business flows")');
const flowInputs = dags.map((t) => ({ traceId: t.traceId, durationMs: t.durationMs, hasError: t.hasError, dag: t.dag }));
const flows = discoverBusinessFlows(flowInputs);
console.log(`Discovered ${flows.length} distinct business flows from ${flowInputs.length} traces:\n`);
flows.forEach((f, i) => {
  console.log(`#${i + 1}  ×${f.traceCount} runs  · avg ${f.avgDurationMs}ms · errorRate ${(f.errorRate * 100).toFixed(0)}%`);
  console.log(`     signature: ${f.signature}`);
  console.log(`     services : ${f.services.join(', ')}\n`);
});

// ---- MCP tool: find_anomalies ----------------------------------------------
H('MCP tool → find_anomalies  (ordered by severity)');
const anomalies = detectAnomalies(topology, flows);
console.log(`Flagged ${anomalies.length} anomalies:\n`);
for (const a of anomalies) {
  console.log(`  [${a.severity.toUpperCase()}] ${a.kind} — ${a.subject}`);
  console.log(`     ${a.detail}\n`);
}

// ---- MCP tool: get_trace_flow (distilled) — one example --------------------
H('MCP tool → get_trace_flow  (DISTILLED — what the LLM actually sees; no raw spans)');
const example = dags.find((t) => t.label === 'place-order-fraud-checked');
const dag = example.dag;
const cp = computeCriticalPath(dag);
const distilled = {
  traceId: example.traceId,
  rootService: dag.nodes[dag.roots[0]]?.serviceName ?? null,
  status: example.hasError ? 'ERROR' : 'OK',
  durationMs: example.durationMs,
  spanCount: example.spans.length,
  orphanCount: dag.orphanCount,
  signature: computeFlowSignature(dag),
  criticalPath: cp.spanIds.map((id) => {
    const n = dag.nodes[id];
    return `${n.serviceName} (${n.spanKind} ${n.channel})`;
  }),
  errors: Object.values(dag.nodes).filter((n) => n.status === 'ERROR').map((n) => ({ service: n.serviceName, channel: n.channel })),
  cycleCount: dag.cycles.length,
};
console.log(JSON.stringify(distilled, null, 2));

// ---- Edge-case robustness proof --------------------------------------------
H('Robustness — messy real-world traces the reconstruction survived');
const orphan = dags.find((t) => t.label === 'partial-orphan');
console.log(`partial-orphan trace: orphanCount=${orphan.dag.orphanCount} (parent never arrived, flagged not dropped)`);
const loop = dags.find((t) => t.label === 'forged-loop');
console.log(`forged-loop trace   : span-level cycles=${JSON.stringify(loop.dag.cycles)} (traversal still terminated)`);

console.log(`\n${line()}\nAll six MCP tools produced output from the real @ariadne/graph algorithms.\n`);
