# Ariadne — Project Instructions

## What this is

**Ariadne** is the codebase for **EventTracer** — transport-agnostic distributed tracing for event-driven and API-based systems. One trace across Kafka, RabbitMQ, and REST, with **zero tracing code in client services**.

**Source of truth:** [`EventTracer-Specification.md`](./EventTracer-Specification.md) (Unified Architecture & Design Spec, v3.1, June 2026), at the repo root. When in doubt, the spec wins.

## Stack

- **Monorepo:** Nx 22 (integrated layout, `apps/` + `libs/`)
- **Backend:** NestJS — all backend apps (`apps/api`, `apps/collector`, `apps/agent` later)
- **Frontend:** Angular 21 — signals, standalone components, zoneless change detection (`apps/ui`)
- **Shared types:** TypeScript in `libs/protocol`
- **Client SDKs (Phase 6):** TypeScript (NestJS module), Python, Java/Spring
- **Local dev (later):** docker-compose for Kafka, RabbitMQ, Postgres, demo mesh
- **Scale (later):** Kubernetes with KEDA (autoscale collector on `_tracing` lag) + Strimzi (Kafka operator)

## Workspace layout

```
apps/
  api/          NestJS — REST API (spec §8): /api/traces, /api/topology, /api/stats
  collector/    NestJS — consumes _tracing, batch-writes spans + traces aggregate
  ui/           Angular 21 — Timeline, Flow diagram, Topology map
libs/
  protocol/     Shared TS — Envelope headers + span event schema (Layer 1, spec §3)
```

Planned additions (later phases): `libs/transport-core`, `libs/transport-{kafka,rabbitmq,rest}`, `libs/sdk-nestjs`, `libs/graph`, `apps/agent`, `sdks/python`, `sdks/java`.

## Layered architecture (spec §2)

Four stacked layers plus one cross-cutting Security layer. The **Transport Abstraction
Layer** is the technical heart — it is what makes "any environment, any language" possible.

```
LAYER 4 — INTELLIGENCE   AI agent: tool-using LLM, reasons over the distilled graph (reads via the API).
LAYER 3 — SYSTEM         EventTracer platform: Collector → PostgreSQL → REST API → Angular UI.
LAYER 2 — TRANSPORT ★    The core. One Transport port + BaseTransport; adapters: Kafka · RabbitMQ · REST.
LAYER 1 — PROTOCOL       Transport- and language-neutral contract: the Envelope + span-event schema.
CROSS-CUTTING — SECURITY Wraps every boundary B1–B5 (Section 10).
```

**The key split.** The original design fused "protocol + Kafka SDK." This spec separates
them: the *protocol* (Layer 1) is a pure contract; the *Transport Abstraction* (Layer 2)
realizes it once and adapts it to each environment and language. That single split is what
turns a Kafka-only tracer into a tool any company can adopt.

## Layer 1 — Protocol (spec §3)

A contract, not code. Headers are metadata attached to the message, separate from the
business payload — **the payload is never modified**.

**Envelope headers** (carried as Kafka `record.headers`, AMQP `properties.headers`, or HTTP
headers; settled carrier is W3C `traceparent` — see Settled decisions):

| Header | Meaning |
|---|---|
| `x-trace-id` | Shared across the whole flow |
| `x-span-id` | This single operation |
| `x-parent-span-id` | The operation that triggered it |
| `x-service-name` | Who set the headers |
| `x-correlation-id` | Pairs a request with its reply |

**Span event** (emitted to `_tracing`):

| Field | Type | Description |
|---|---|---|
| `traceId` | UUID | Same across the entire flow |
| `spanId` / `parentSpanId` | UUID / null | This op; link to parent (null = root) |
| `serviceName` | string | Emitting service |
| `spanKind` | PRODUCER / CONSUMER | Publish or receive |
| `transport` | kafka / rabbitmq / rest | Who carried the message |
| `channel` | string | Topic / routing key / route (renamed from `topic`) |
| `operationName` | string | Handler / operation name |
| `startTime` / `durationMs` | ISO-8601 / number | When + how long |
| `status` / `error` | OK / ERROR / string | Outcome |
| `metadata` | object / null | Optional business context — **allowlist-redacted at source** (§10) |

## Layer 2 — Transport Abstraction (spec §4, the core)

Two universal patterns; many transports. Business code knows only the patterns. Each
transport declares what it supports natively vs emulated — a mismatch fails loudly at
wiring time, not at runtime.

- **Request/Reply** — `request(target, msg) → reply`. Native: REST. Emulated: Kafka/Rabbit via `correlationId` + reply channel.
- **Publish/Subscribe** — `publish(event)` / `subscribe(pattern, handler)`. Native: Kafka, RabbitMQ. Emulated: REST via outbox + webhooks/polling.

**Port + base class — inheritance where it belongs.** Transports don't inherit from each
other. They share one thing — trace injection and span emission — which lives in
`BaseTransport` and is inherited **once**. What differs (how bytes leave the wire) is
implemented through the `Transport` interface (`publish` / `subscribe` / `request`, plus a
`caps: Capabilities`). `BaseTransport.publish` injects trace context, starts a PRODUCER
span, calls the abstract `doPublish`, then fire-and-forget emits the span to `_tracing`.

**Capability matrix:**

| Transport | Pub/Sub | Req/Reply | Ordering | Trace carrier |
|---|---|---|---|---|
| Kafka | native | emulated | per-partition | record headers |
| RabbitMQ | native | native (RPC) | per-queue | AMQP headers |
| REST | emulated | native | n/a | HTTP headers |

## Integration model (spec §5–6)

**The service developer writes zero spans, zero log calls, zero trace plumbing.** Adoption
is at one of three levels — conceptually identical in every language:

- **Zero-touch (DEFAULT)** — install + config only; the SDK hooks the framework lifecycle. No code changes.
- **Wrap / Decorate** — one line: wrap the producer/consumer or decorate a handler. For setups the auto-hook can't reach.
- **Inherit (OPTIONAL)** — extend `BaseTransport` only when **building a custom transport**. Not the default.

Default everywhere is **composition / dependency injection**; inheritance exists only inside
our own code and as an escape hatch for new transports.

| Language | Producer hook | Consumer hook | Context carrier | Effort |
|---|---|---|---|---|
| TypeScript / NestJS | Custom serializer | Global interceptor | AsyncLocalStorage | npm install + 1 import |
| Python | Wrapper / decorator | Wrapper / decorator | contextvars | pip install + wrap objects |
| Java / Spring | ProducerInterceptor | ConsumerInterceptor | ThreadLocal | Maven dep + 2 lines yaml |
| Any other | Manual: set headers + emit span | (same) | language-native | ~10–20 lines |

## Per-transport implementation (spec §7)

Each adapter implements `doPublish` / `doSubscribe` / `doRequest` and maps trace headers to
its native mechanism; spans are emitted by `BaseTransport` for all three.

- **Kafka** — carrier = `record.headers`; consumer group per service; partition key = entity id (e.g. `orderId`) for per-entity ordering; req/reply emulated via `correlationId` + `replyTo` topic; at-least-once → idempotent handlers (dedup by `spanId`); failures → DLQ.
- **RabbitMQ** — carrier = AMQP `properties.headers`; publish to topic/fanout exchange, queues bound by routing key; req/reply native via direct reply-to (RPC) + `correlationId`; backpressure via `prefetch`, `ack`/`nack` with a Dead-Letter-Exchange.
- **REST / HTTP** — carrier = HTTP headers (or W3C `traceparent`); req/reply native (the reply *is* the response); pub/sub emulated via an outbox table + webhook dispatcher (or subscribers poll).

## Layer 3 — System internals (spec §8)

**Collector → PostgreSQL → REST API → Angular UI.**

- **Collector** — own consumer group `eventtracer-collector-group`; batch-inserts (100 spans **or** 500 ms); upserts the `traces` aggregate after each batch. Idempotent & order-independent — spans arrive out of order; upsert keyed by `spanId`.
- **Database** — `spans` (raw; indexed on trace_id / service / time) + `traces` (pre-computed aggregate: root service, span count, duration, error flag) to avoid GROUP BY on listing. Time-partition + TTL; ClickHouse as a drop-in at very high volume.
- **API** — `GET /api/traces`, `/api/traces/:id` (spans + pre-built DAG), `/api/topology`, `/api/stats`.
- **UI (Angular 21)** — Timeline (bars on a time axis), Flow diagram (one trace as a DAG), Topology map (all traces aggregated; force-directed via D3; signals + zoneless updates).

## Layer 4 — Intelligence & Security (spec §9–10)

**Agent (Phase 7).** Algorithms distill structure; the agent reasons over it. Raw spans
never reach the model — the distilled graph does. It uses read-only, RBAC-scoped tools that
call the same API a user would. It discovers/names business processes, explains decision
points, flags anomalies (cycles, dead branches, latency-dominant paths), and generates
living documentation from reality.

**Security boundaries:**

- **B1 Ingestion** — transport identity (mTLS/SASL/AMQP auth); channel ACLs (adapters may only write `_tracing`, only the collector group reads it); PII redaction at source; fail-safe emission.
- **B2 Storage** — encryption in transit + at rest; least-privilege DB role (INSERT/UPSERT only); TTL + GDPR erasure; replay defense via idempotent upsert by `spanId`.
- **B3 Access** *(crown jewel)* — OIDC/JWT authN; RBAC + tenant isolation (a team sees only its own services); rate limiting + query bounds; audit log.
- **B4 Agent** — trace data is untrusted input → defend against indirect prompt injection; read-only scoped tools; secrets in a manager; self-hosted model option.
- **B5 Platform** — default-deny NetworkPolicies; secrets via Vault/sealed-secrets; non-root hardened pods; image scanning & signing in CI.

**The one rule:** the most dangerous path is `metadata` flowing untrusted into the agent —
sanitize at the adapter (B1), re-validate at the agent (B4).

## Algorithmic core (spec §11)

The domain is a graph — the algorithms are the product.

| Capability | Algorithm |
|---|---|
| Reconstruction | tree/DAG from parent — BFS/DFS |
| Loop detection | DFS coloring |
| Critical path | topo-sort + DP |
| Topology aggregation | merge DAGs → weighted graph |
| Path variants | signature + clustering |

## Non-negotiable rules from the spec

1. **Zero tracing code in client services.** Tracing lives inside the SDK. Any pattern requiring `extends BaseTracer` in user code is wrong by default — use composition, DI, interceptors. Inheritance is reserved for **building** transports (`extends BaseTransport`), not for **consuming** them.

2. **Fail-safe `_tracing` emitter.** The tracing producer is separate from the app producer and is fire-and-forget with a bounded buffer + drop policy. If `_tracing` is slow or down, business logic must **never** block, slow, or crash. Non-negotiable.

3. **Protocol is transport-agnostic.** Envelope headers (`x-trace-id`, `x-span-id`, `x-parent-span-id`, `x-service-name`, `x-correlation-id`) carry across Kafka `record.headers`, AMQP `properties.headers`, and HTTP headers. The `parentSpanId` chain is what stitches services together.

4. **Distill before reasoning.** When the AI agent (Phase 7) lands: raw spans never reach the LLM — algorithms distill the graph first; the agent reasons over the distilled structure.

## Node version

Use **Node 22**. Node 18 is below Angular 21's minimum. If `node --version` shows 18, run `nvm use 22` first.

## npm cache

A stale root-owned file lives at `~/.npm/_cacache` (likely from a past `sudo npm`). If installs fail with `EACCES` on `/Users/edenbensimhon/.npm/_cacache`, use a local cache:

```bash
npm install ... --cache=/tmp/ariadne-npm-cache
```

## Common commands

```bash
# Build all projects
npx nx run-many --target=build --all

# Build only what changed
npx nx affected -t build

# Serve apps
npx nx serve api          # NestJS API
npx nx serve collector    # NestJS collector
npx nx serve ui           # Angular UI

# Test
npx nx run-many --target=test --all
npx nx test protocol

# Lint
npx nx run-many --target=lint --all

# Visualize the workspace
npx nx graph
```

## Roadmap pointer

Spec §12 defines 8 phases. **MVP = Phases 1–6.**

1. **Protocol + Envelope** — `libs/protocol`: headers + span schema. Everything depends on this.
2. **Transport core + Kafka adapter + TS SDK** — `BaseTransport`, fail-safe emitter, NestJS zero-touch module.
3. **Collector + DB** — Postgres `spans` + `traces` tables; batch inserts; idempotent upsert by `spanId`.
4. **API + reconstruction** — REST endpoints + graph algorithms (BFS/DFS, cycle detection, topo-sort).
5. **Angular 21 UI** — Timeline / Flow / Topology views.
6. **RabbitMQ + REST adapters, Python + Java SDKs, Security B1–B3** — proves "any environment, any language."
7. **AI agent** — tool-using LLM over the distilled graph (Security B4).
8. **Kubernetes + high scale** — KEDA, Strimzi, additional SDKs, Security B5.

**MVP definition of done:** one `POST /orders` flows through the demo mesh across Kafka + RabbitMQ + REST, produces a single connected 6-span trace, visible end-to-end in the UI, with demo services containing zero tracing code.

## Settled decisions (spec §12 "open decisions")

These are tracked but not yet locked in code:

- **Header format:** W3C `traceparent` (spec recommendation — interop with broader observability ecosystem).
- **Kafka req/reply:** per-instance reply topic + `correlationId` routing.
- **Multi-tenancy:** yes from day one — affects DB keys and RBAC, cheaper than retrofitting.
- **Agent model:** deferred to Phase 7 (hosted vs self-hosted depends on trace-data sensitivity).

## Scope discipline

Spec's own warning: *"the worst outcome is an ambitious build stalled at 40%."* Ship Phases 1–6 as a coherent MVP before reaching for the agent or Kubernetes.
