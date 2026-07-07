# EventTracer — Phase Checklist

Every phase from the spec (§12) with its concrete steps and where each landed.
✅ done · 🔜 deferred (documented seam) · ➖ out of MVP scope by design.

**Verification:** `npx nx run-many -t lint,test,build --all` — 14 projects, 253 tests, all green (verified fresh with `--skip-nx-cache`, branch `dev`).

---

## Phase 1 — Protocol + Envelope ✅  (`libs/protocol`)

- [x] Envelope headers: `traceparent` (W3C canonical) + `x-trace-id`, `x-span-id`, `x-parent-span-id`, `x-service-name`, `x-correlation-id`, `x-tenant-id` — `constants.ts`
- [x] W3C-native IDs: TraceId = 32 hex, SpanId = 16 hex, `crypto.getRandomValues`, browser-safe — `ids.ts`
- [x] Branded zod v4 types (`TraceId`/`SpanId`/`TenantId`) — swapping ids is a compile error — `schemas/primitives.ts`
- [x] Strict span-event schema (unknown keys rejected, every field bounded, status⟺error invariant) — `schemas/span-event.ts`
- [x] Traceparent codec: strict parse, dual-write inject, case-insensitive extract with precedence — `traceparent.ts`
- [x] PII allowlist redaction (flat primitives, `__proto__` defense) — `redaction.ts`
- [x] Multi-tenancy from day one: `tenantId` required on every span/context
- [x] 49 unit tests

## Phase 2 — Transport core + Kafka adapter + TS SDK ✅

**`libs/transport-core`**
- [x] `Transport` port (publish/subscribe/request) + `Capabilities` with wiring-time `assertCapabilities`
- [x] `BaseTransport` template method: header injection, PRODUCER/CONSUMER spans in `finally`, errors rethrown
- [x] `ContextManager` port + AsyncLocalStorage impl (parentSpanId chaining across a service hop)
- [x] Fail-safe `BoundedSpanEmitter`: preallocated ring buffer, drop-newest, unref'd timer, drop counters — `emit()` sync O(1), never throws
- [x] Testing kit (`FakeTransport` in-memory mesh, `CapturingEmitter`, manual clock, sequential ids)
- [x] Acceptance test: 3-service chain → 4 spans, one traceId, `null→S1→S2→S3`

**`libs/transport-kafka`**
- [x] Headers → `record.headers`; consumer group `svc.<service>`; partition key = entity id
- [x] `KafkaSpanSink` on a **separate Kafka client** (tracing ≠ app producer, by construction)
- [x] DLQ `<topic>.dlq` on poison messages; at-least-once redelivery keeps the same spanId
- [x] Emulated req/reply: per-instance reply topic + correlationId + timeout

**`libs/sdk-nestjs`** (zero tracing code in client services)
- [x] `EventTracerModule.forRoot/forRootAsync` — one import is the whole integration
- [x] Transport port via DI (Surface A) + global consumer interceptor / ClientKafka serializer (Surface B)
- [x] Wiring-time validation (tenant/serviceName/capabilities), lifecycle connect + flush-on-shutdown

## Phase 3 — Collector + DB ✅  (`apps/collector`, `libs/storage`, compose)

- [x] docker-compose: Kafka (KRaft), Postgres 16, RabbitMQ; least-privilege role init SQL
- [x] Drizzle schemas: `spans` PK `(tenant_id, span_id, start_time)`, `traces` PK `(tenant_id, trace_id)` + stored `duration_ms`
- [x] Migrations: generated traces, hand-written **daily-partitioned** spans (−7d…+90d pre-created, `spans_ensure_partition()` seam), grant tightening; `nx run storage:migrate` as owner — collector cannot run DDL
- [x] `PgTraceStore`: one transaction per chunk, `ON CONFLICT DO NOTHING … RETURNING` (replay defense), aggregate delta from RETURNING rows only (exact `span_count` under redelivery), commutative traces upsert, deadlock-free ordering
- [x] Consumer: raw kafkajs `eachBatch`, group `eventtracer-collector-group`, `eachBatchAutoResolve: false` — offsets resolve only after commit; broker-level batching (100 spans / 500 ms)
- [x] B1 ingestion gate: size guard → JSON parse → `parseSpanEvent` → span-age window (forged timestamps can't crash-loop INSERTs)
- [x] DB-down policy: bounded retries with heartbeats → crash-and-restart; row-by-row fallback for poison spans
- [x] `/healthz` with counters; graceful shutdown consumer→pool; smoke seeder `tools/smoke/seed-tracing.mjs`
- [ ] 🔜 TTL/partition-maintenance job (drop expired partitions — seam exists)

## Phase 4 — API + reconstruction ✅  (`apps/api`, `libs/graph`)

- [x] `buildTraceDag`: parentSpanId → forest with depths/offsets; orphans flagged; duplicate spans deduped; forged loops detected, traversal terminates
- [x] `detectCycles` (iterative DFS 3-coloring), `computeCriticalPath`, `buildTopology` (weighted service graph, no self-edges, choreography cycles surfaced, truncation flag)
- [x] `TraceReader` (SELECT-only role): keyset pagination on `(start_time, trace_id)`, tenant-first WHERE in every query, percentile stats
- [x] `GET /api/traces` (cursor paging, bounded zod params), `GET /api/traces/:id` (spans + DAG + critical path, 400/404 split), `GET /api/topology` (windowed, row-capped), `GET /api/stats`, `GET /api/healthz`
- [x] Required validated `x-tenant-id` header — **no default tenant**; `@Tenant()` decorator is the Phase-6 auth seam
- [x] e2e spec suite (tenancy isolation, cursor walk, error filters) — needs compose to run

## Phase 5 — Angular 21 UI ✅  (`apps/ui`, signals + zoneless)

- [x] Signal-native data layer: `httpResource` everywhere, filters/paging as `signal`/`computed`, route params via signal `input.required`
- [x] Types imported from `@ariadne/graph` (platform:shared) — zero contract drift with the API
- [x] Traces list: keyset cursor paging, root-service + errors-only filters, service color coding
- [x] Timeline: pure `computeTimelineRows` → indented Gantt bars (plain divs), orphan banner, axis ticks
- [x] Flow: pure `layoutDag` → Angular-templated SVG DAG with bezier edges, error highlighting
- [x] Topology: d3-force island (signal input → effect → untracked render, DestroyRef cleanup) — the only D3 in the app
- [x] **Live** page: realtime trace feed over SSE (`/api/events`) — RxJS Observable at the EventSource boundary bridged into signals; pause/resume, clear, errors-only filter, connection-status pill
- [x] Tenant interceptor, dev proxy `/api→:3000`, mock-API mode, dark dev-tool theme

## Phase 6 — More transports + security baseline ✅ core / 🔜 rest

- [x] `libs/transport-rabbitmq`: native pub/sub (topic exchange, durable queues, prefetch) + **native** RPC (replyTo + correlationId); DLX dead-lettering on nack; `RabbitSpanSink` on its own connection
- [x] `libs/transport-rest`: native req/reply over Node fetch (timeout → `RequestTimeoutError`), honest `pubsub: 'none'`
- [x] Security B1: transport auth plumbing (SASL/SSL config), `_tracing` separation, redaction at source
- [x] Security B2: least-privilege DB roles, idempotent replay defense, SSL switches
- [x] Security B3 (baseline): required validated tenant header, structural tenant isolation in SQL, bounded queries; 🔜 OIDC/JWT + RBAC + rate limiting behind the `@Tenant()` seam
- [x] REST server-side tracing (`createTracedRestServer` — CONSUMER spans from inbound HTTP, handlers in ALS context)
- [ ] 🔜 REST pub/sub emulation (outbox + webhooks)
- [ ] 🔜 Python SDK (decorator + contextvars), Java/Spring SDK (interceptors + ThreadLocal) — protocol is language-neutral; generic manual integration is ~15 lines
- [x] Demo mesh `apps/demo-mesh`: POST /orders → one connected trace across Kafka + RabbitMQ + REST, zero tracing code in handlers (run: `npx nx serve demo-mesh`)

## Phase 7 — Intelligence ✅ seeded  (`apps/mcp`)

- [x] `computeFlowSignature` + `discoverBusinessFlows` (path-signature clustering — spec §11 "path variants")
- [x] MCP stdio server, 7 tools: `discover_business_flows`, `get_trace_flow`, `get_topology`, `list_traces`, `get_stats`, `find_anomalies`, `get_recent_activity`
- [x] B4: read-only tenant-scoped tools; raw spans/metadata never reach the model; error strings sanitized
- [x] Anomaly flagging: `detectAnomalies` (cycles, error hotspots, latency-dominant hops, failing flows) — served by `/api/anomalies`, shown in the UI Flows tab, exposed as the MCP `find_anomalies` tool
- [x] `/api/flows` + UI **Flows** page — the UI and the MCP agent consume the same distilled endpoints
- [x] `get_recent_activity` (asks about the "logs" / recent behaviour) over `/api/events/recent` — same distilled feed as the UI **Live** tab
- [x] Friendly connect: server `instructions` guide the agent's tool use; `.mcp.json.example` for one-click Claude Code registration
- [ ] 🔜 living-documentation generation

## Phase 8 — Kubernetes + high scale ➖ (post-MVP by design)

- [ ] ➖ KEDA autoscaling on `_tracing` lag, Strimzi, NetworkPolicies, Vault, image signing — the spec schedules this after the MVP

---

### Documents
- `docs/TUTORIAL.md` — hands-on walkthrough with examples (quickstart, zero-touch instrumentation, API, MCP)
- `docs/IMPLEMENTATION.md` — architecture, decisions and test map per phase
- `CLAUDE.md` — project rules; the spec PDF remains the source of truth
