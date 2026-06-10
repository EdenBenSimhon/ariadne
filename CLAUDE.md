# Ariadne — Project Instructions

## What this is

**Ariadne** is the codebase for **EventTracer** — transport-agnostic distributed tracing for event-driven and API-based systems. One trace across Kafka, RabbitMQ, and REST, with **zero tracing code in client services**.

**Source of truth:** `/Users/edenbensimhon/Downloads/EventTracer-Specification.pdf` (Unified Architecture & Design Spec, v3.1, June 2026). When in doubt, the spec wins.

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
