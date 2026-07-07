# EventTracer — Tutorial

*Transport-agnostic distributed tracing: one trace across Kafka, RabbitMQ and REST, with **zero tracing code in your services**.*

This walks you from an empty machine to seeing a connected multi-service trace in the UI, then shows how to instrument your own services.

---

## 0. Fastest path — scripts

If you just want it running, the `scripts/` wrappers do the steps below for you
(each loads Node 22 first). See `docs/RUNBOOK.md` for the full reference.

```bash
./scripts/verify.sh    # no Docker: build + test all + MCP flow-recognition demo
./scripts/demo.sh      # just the MCP demo + stdio probe
./scripts/up.sh        # needs Docker: infra + migrate + all services + one smoke order
./scripts/down.sh      # stop the up.sh stack
```

The rest of this tutorial spells out those steps and then shows how to instrument
your own service.

---

## 1. Prerequisites

- **Node 22** (`nvm use 22` — Node 18 is too old for Angular 21)
- **Docker** (for Kafka, RabbitMQ, Postgres)

```bash
git clone <repo> && cd ariadne
nvm use 22
npm install
```

## 2. Start the stack

Four terminals (or background the first three):

```bash
# ① infrastructure: Kafka (KRaft), RabbitMQ, Postgres 16 + least-privilege roles
docker compose up -d

# ② apply DB migrations (runs as the dev owner; services never migrate)
npx nx run storage:migrate

# ③ the collector — consumes _tracing → Postgres
npx nx serve collector          # health: http://localhost:3001/healthz

# ④ the read API
npx nx serve api                # health: http://localhost:3000/api/healthz

# ⑤ the UI (proxies /api to :3000)
npx nx serve ui                 # http://localhost:4200
```

## 3. The real thing: one request across Kafka + RabbitMQ + REST

The demo mesh is the MVP's definition of done — three services with **zero tracing code**, chained across all three transports:

```bash
npx nx serve demo-mesh     # order-service (REST :4001) → kafka → inventory → rabbitmq → payment → rest → order

curl -s -X POST localhost:4001/orders \
  -H 'content-type: application/json' -d '{"orderId":"ord-42"}'
```

Wait ~2 seconds (collector batch window), then open **http://localhost:4200** — one connected trace: REST CONSUMER → Kafka PRODUCER/CONSUMER → RabbitMQ PRODUCER/CONSUMER → REST PRODUCER/CONSUMER, all under a single traceId. The **Flows** tab now shows the discovered business flow `order-service -[orders.created]-> inventory-service | …` with its run count and error rate.

## 3b. See a trace end-to-end (no brokers running for the mesh)

Seed the spec's worked example — one `POST /orders` flow producing a 6-span chain across three services — straight into `_tracing`:

```bash
node tools/smoke/seed-tracing.mjs
```

Now:

```bash
curl -s -H 'x-tenant-id: acme' localhost:3000/api/traces | python3 -m json.tool
```

```json
{
  "items": [
    {
      "traceId": "9f8e7d6c…",
      "rootService": "order-service",
      "spanCount": 6,
      "startTime": "2026-07-07T09:58:41.000Z",
      "endTime": "2026-07-07T09:58:41.420Z",
      "durationMs": 420,
      "hasError": true
    }
  ],
  "nextCursor": null
}
```

Open **http://localhost:4200** → the trace list shows both seeded traces. Click one:

- **Timeline** — Gantt bars indented by call depth, colored per service, error spans outlined red.
- **Flow** — the trace as a DAG: `order-service → inventory-service → payment-service → order-service`.
- **Topology** — a force-directed map of all services; the `order → payment → order` loop is real event choreography and is surfaced, not hidden.

> Every API call needs the `x-tenant-id` header. There is deliberately **no default tenant** — multi-tenancy is on from day one, and phase-6 auth will only swap where the tenant comes from.

## 4. Instrument your own NestJS service (zero-touch)

Install nothing into your business logic. One module import is the entire integration:

```ts
// app.module.ts — the ONLY change your service needs
import { Module } from '@nestjs/common';
import { EventTracerModule } from '@ariadne/sdk-nestjs';

@Module({
  imports: [
    EventTracerModule.forRoot({
      serviceName: 'order-service',
      tenantId: 'acme',
      transport: { kafka: { brokers: ['localhost:9092'] } },
      // PII never leaves the service: only allowlisted payload keys become
      // span metadata; everything else is scrubbed at source.
      redaction: { allowlist: ['orderId'] },
    }),
  ],
})
export class AppModule {}
```

Your business code stays pure. Inject the transport **port** and publish — trace headers, span creation and fail-safe emission happen underneath:

```ts
// orders.service.ts — zero tracing code below this line
import { Inject, Injectable } from '@nestjs/common';
import { EVENT_TRACER_TRANSPORT } from '@ariadne/sdk-nestjs';
import type { Transport } from '@ariadne/transport-core';

@Injectable()
export class OrdersService {
  constructor(@Inject(EVENT_TRACER_TRANSPORT) private readonly bus: Transport) {}

  async createOrder(orderId: string) {
    await this.bus.publish({
      channel: 'orders.created',
      headers: {},
      payload: { orderId },
      key: orderId,            // partition key → per-order ordering
    });
  }
}
```

The consuming service is equally untouched:

```ts
// inventory.service.ts
this.bus.subscribe('orders.created', async (envelope) => {
  const { orderId } = envelope.payload as { orderId: string };
  await this.reserveStock(orderId);
  await this.bus.publish({ channel: 'inventory.reserved', headers: {}, payload: { orderId } });
});
```

That's it. Each hop automatically:
1. extracts the inbound trace context (`traceparent` preferred, `x-*` fallback),
2. runs your handler inside `AsyncLocalStorage` so downstream publishes chain correctly,
3. emits `CONSUMER`/`PRODUCER` spans to `_tracing` — **fire-and-forget through a bounded ring buffer**: if `_tracing` is slow or down, spans are dropped and counted, and your business traffic never blocks.

Teams using Nest's own `@MessagePattern`/`ClientKafka` instead of the port get the same result from the globally registered consumer interceptor plus the `EventTracerKafkaSerializer` (config-only registration).

### Request/reply and other transports

```ts
// Ask another service and await the answer — same port, any transport:
const reply = await this.bus.request('inventory.check', {
  channel: 'inventory.check',
  headers: {},
  payload: { sku: 'sku-1' },
});
```

| Transport | pub/sub | req/reply | wire carrier |
|---|---|---|---|
| Kafka (`@ariadne/transport-kafka`) | native | emulated (per-instance reply topic + correlationId) | record headers |
| RabbitMQ (`@ariadne/transport-rabbitmq`) | native | native (replyTo + correlationId) | AMQP properties.headers |
| REST (`@ariadne/transport-rest`) | — (deferred) | native (plain HTTP) | HTTP headers |

Declaring `requires: { reqreply: true }` in `forRoot` makes a capability mismatch **fail at startup**, never at runtime.

## 5. Query the API directly

```bash
T='-H x-tenant-id:acme'
BASE=localhost:3000/api

curl -s $T "$BASE/traces?limit=10&status=error"        # newest-first, keyset cursor paging
curl -s $T "$BASE/traces?cursor=<nextCursor>"           # next page
curl -s $T "$BASE/traces/<traceId>"                     # spans + prebuilt DAG + critical path
curl -s $T "$BASE/topology?from=2026-07-01T00:00:00Z"   # weighted service graph
curl -s $T "$BASE/stats"                                # counts, error rate, p50/p95
```

`GET /traces/:id` returns the reconstructed graph so clients never re-derive it:

```json
{
  "trace":  { "traceId": "…", "rootService": "order-service", "spanCount": 6, "hasError": true, "durationMs": 420 },
  "spans":  [ { "spanId": "…", "parentSpanId": null, "startTimeMs": 1751882321000, "…": "…" } ],
  "dag": {
    "roots": ["a1b2…"],
    "nodes": { "a1b2…": { "depth": 0, "children": ["c3d4…"], "startOffsetMs": 0, "orphaned": false } },
    "orphanCount": 0,
    "cycles": []
  },
  "criticalPath": { "spanIds": ["a1b2…", "c3d4…"], "durationMs": 420 }
}
```

Partial traces are honest: spans whose parent hasn't arrived yet appear as `orphaned` roots and the UI shows a "partial trace" banner.

## 6. How a trace is stitched (the 30-second version)

```
producer stamps headers          consumer reads headers
┌─────────────────┐   message   ┌──────────────────┐
│ traceparent      ├────────────▶ parentSpanId =    │
│ x-span-id = S1   │             │ producer's S1     │
└───────┬─────────┘             └────────┬─────────┘
        │ span S1 (PRODUCER)              │ span S2 (CONSUMER)
        ▼          fire-and-forget        ▼
        `_tracing` ──▶ collector ──▶ Postgres ──▶ API ──▶ UI
```

The `parentSpanId` chain (`null → S1 → S2 → …`) is the whole trick — it works identically across Kafka record headers, AMQP properties and HTTP headers because the protocol (`libs/protocol`) is a pure contract.

## 7. Building a custom transport (the one place inheritance belongs)

Client services never extend anything — but **transport authors** extend `BaseTransport` once and get tracing for free:

```ts
import { BaseTransport, type Capabilities, type Handler, type Subscription } from '@ariadne/transport-core';
import type { Envelope } from '@ariadne/protocol';

export class MyQueueTransport extends BaseTransport {
  override readonly name = 'myqueue';
  override readonly caps: Capabilities = { pubsub: 'native', reqreply: 'none' };
  protected override readonly transportKind = 'kafka'; // closest protocol kind

  protected override async doPublish(e: Envelope) { /* move bytes; headers are already stamped */ }
  protected override doSubscribe(pattern: string, handler: Handler): Subscription { /* wire handler */ }
  protected override doRequest(): Promise<Envelope> { throw new Error('unsupported'); }
  override async connect() { /* … */ }
  override async close() { /* … */ }
}
```

`publish/subscribe/request` are final in spirit: they inject headers, time the operation, emit spans in `finally`, and rethrow business errors. You only move bytes.

## 8. Verifying and exploring

```bash
npx nx run-many -t lint,test,build --all    # the full gate (all projects)
npx nx test transport-core                   # includes the 4-span chain acceptance test
npx nx graph                                 # protocol ← transport-core ← adapters/sdk; storage/graph ← apps
```

## 9. Ask an AI about your business flows (MCP)

`apps/mcp` is an MCP server that lets any MCP client (Claude Code, Claude Desktop, …) reason about your system — over **distilled** graph structure only; raw spans and payload metadata never reach the model (spec's rule 4, security B4).

```bash
npx nx build mcp
```

Register it with your MCP client (e.g. in Claude Code):

```json
{
  "mcpServers": {
    "eventtracer": {
      "command": "node",
      "args": ["<repo>/dist/apps/mcp/main.js"],
      "env": { "MCP_API_URL": "http://localhost:3000/api", "MCP_TENANT_ID": "acme" }
    }
  }
}
```

Tools exposed (all read-only, tenant-scoped):

| Tool | What it answers |
|---|---|
| `discover_business_flows` | *"What business processes actually run here?"* — clusters recent traces by their service/channel hop signature: each distinct flow with frequency, error rate, avg duration |
| `find_anomalies` | *"What's wrong?"* — service cycles, error-hotspot hops, latency-dominant hops, failing flows, ordered by severity |
| `get_recent_activity` | *"What just happened / anything failing right now?"* — the recent activity **log**: last N traces with status, service, duration (same feed as the UI **Live** tab) |
| `get_trace_flow` | one trace as hops + critical path + sanitized errors (no spans, no metadata) |
| `get_topology` | who talks to whom, over which channels, with weights and loops |
| `list_traces`, `get_stats` | recent traces and tenant-wide health numbers |

**One-click connect:** `cp .mcp.json.example .mcp.json` in the repo root, then
`npx nx build mcp` — Claude Code auto-connects the server, and its built-in
`instructions` steer the agent to the right tool.

**The UI and the AI see the same picture:** `discover_business_flows` and `find_anomalies` are served by the same `/api/flows` and `/api/anomalies` endpoints that power the UI's **Flows** tab — one implementation in `libs/graph`, three consumers (API, UI, MCP).

Example prompt once connected: *"Discover the business flows in my system, name them, and tell me which one is failing most and where in the chain it breaks."* The model calls `discover_business_flows`, then drills into failing examples with `get_trace_flow` — exactly the spec §9 loop: algorithms distill, the agent reasons and explains.

## 10. What's deliberately not here yet

- **Python / Java SDKs** (spec §6) — the protocol is language-neutral; the generic manual integration is ~15 lines (§6 "any other language").
- **REST pub/sub emulation** (outbox + webhooks) — REST is req/reply-native for now; `assertCapabilities` fails loudly if you require pub/sub on it.
- **AuthN/RBAC (B3)** — the API requires a validated tenant header today; OIDC/JWT swaps in behind the same `@Tenant()` seam.
- **TTL/partition-maintenance job** — daily partitions exist; dropping expired ones is a small scheduled job away (`spans_ensure_partition()` is the seam).
- **AI agent (Phase 7) & Kubernetes (Phase 8)** — after the MVP, per the spec's scope discipline.
