# EventTracer — Implementation Log

> What has been built, why, and how to verify it. Companion to the spec
> (`EventTracer-Specification.pdf` v3.1) and `CLAUDE.md`. Updated per phase.

## Status

| Phase (spec §12) | Scope | Status |
|---|---|---|
| 1 — Protocol + Envelope | `libs/protocol` | ✅ Done |
| 2 — Transport core + Kafka + TS SDK | `libs/transport-core`, `libs/transport-kafka`, `libs/sdk-nestjs` | ✅ Done |
| 3 — Collector + DB | `apps/collector`, `libs/storage`, docker-compose | ✅ Done |
| 4 — API + reconstruction | `apps/api`, `libs/graph` | ✅ Done |
| 5 — Angular 21 UI | `apps/ui` (signals, zoneless, D3 topology) | ✅ Done |
| 6 — RabbitMQ + REST adapters | `libs/transport-rabbitmq`, `libs/transport-rest` | ✅ Done (Python/Java SDKs + OIDC auth deferred) |
| 7 — Intelligence (seed) | `apps/mcp` — MCP server over the distilled graph, `discover_business_flows` path-signature clustering | ✅ Seeded |

**Verification gate (all green):** `npx nx run-many -t lint,test,build --all` — 89 unit tests across 4 libraries, including an end-to-end trace-chain acceptance test.

---

## Settled decisions

| Decision | Choice | Where |
|---|---|---|
| ID format | W3C-native hex: TraceId = 32 hex (16 bytes), SpanId = 16 hex (8 bytes) — a UUID cannot fit a W3C span-id | `libs/protocol/src/lib/ids.ts` |
| Wire headers | **Dual-write**: `traceparent` (canonical, OTel interop) + `x-*` set (carries service name, tenant, correlation, parent) ; consumers prefer `traceparent`, fall back to `x-*` | `libs/protocol/src/lib/traceparent.ts` |
| Branded types | `TraceId` / `SpanId` / `TenantId` are Zod-branded strings — swapping them is a compile error, zero runtime cost | `libs/protocol/src/lib/schemas/primitives.ts` |
| Multi-tenancy | Day one: `tenantId` required on every span and trace context, header `x-tenant-id`; collector will key on `(tenantId, spanId)` | protocol schemas |
| Validation | Zod v4 schemas are the single source of truth: `z.infer` types + runtime validation at the ingestion boundary (B1/B2). `spanEventSchema` is strict — unknown keys rejected | `libs/protocol/src/lib/schemas/span-event.ts` |
| DB layer (Phase 3) | Drizzle ORM — typed SQL, fast batch upserts, plain SQL migrations for partitioning | not yet in code |
| Context propagation | `ContextManager` port in transport-core; default `AsyncLocalStorage` impl. Browser is protected structurally by Nx platform tags, not by keeping core Node-free | `libs/transport-core/src/lib/context/` |

## Architecture (what exists in code)

```
                        ┌──────────────────────────────────────────┐
 client service         │ libs/sdk-nestjs   EventTracerModule      │  zero-touch:
 (zero tracing code) ──▶│  · Transport port via DI (Surface A)     │  forRoot() is the
                        │  · global consumer interceptor +         │  only change
                        │    ClientKafka serializer (Surface B)    │
                        └───────────────┬──────────────────────────┘
                                        │
                        ┌───────────────▼──────────────────────────┐
                        │ libs/transport-core                      │
                        │  · Transport PORT (publish/subscribe/    │
                        │    request) + Capabilities (fail loudly  │
                        │    at wiring time)                       │
                        │  · BaseTransport (template method):      │
                        │    inject headers → time op → emit span  │
                        │  · BoundedSpanEmitter: ring buffer,      │
                        │    drop-newest, unref'd flush timer,     │
                        │    drop counters — emit() is sync O(1),  │
                        │    never throws, never blocks business   │
                        └───────────────┬──────────────────────────┘
                                        │
                        ┌───────────────▼──────────────────────────┐
                        │ libs/transport-kafka (kafkajs)           │
                        │  · headers → record.headers              │
                        │  · consumer group svc.<name>             │
                        │  · KafkaSpanSink on a SEPARATE client →  │
                        │    _tracing (tracing ≠ app producer)     │
                        │  · DLQ <topic>.dlq on poison messages    │
                        │  · req/reply emulated: per-instance      │
                        │    reply topic + correlationId           │
                        └───────────────┬──────────────────────────┘
                                        │
                        ┌───────────────▼──────────────────────────┐
                        │ libs/protocol (framework-free, browser-  │
                        │ safe; only dep: zod)                     │
                        │  headers · span schema · traceparent     │
                        │  codec · ids · PII redaction             │
                        └──────────────────────────────────────────┘
```

## Security posture built in (spec §10)

- **B1 (ingestion)**: `redactMetadata()` — allowlist-only, flat primitives, size caps, `__proto__`/`constructor`/`prototype` dropped; applied at source in `BaseTransport`. `spanEventSchema` is strict and bounds every free-form field (`LIMITS`).
- **B1 (fail-safe)**: tracing producer is a separate Kafka client with tight retries; `BoundedSpanEmitter` guarantees business code never blocks/slows/crashes on `_tracing` trouble — drops are counted, never silent.
- **B2 (replay)**: spanId is generated once per operation *before* any send, so at-least-once redelivery re-emits the same spanId — the Phase-3 collector upserts idempotently by `(tenantId, spanId)`.
- Transport auth (SASL/mTLS) is plumbed through `KafkaTransportConfig.ssl/sasl`.

## Type & performance discipline

- All libs: `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; `no-explicit-any` is an ESLint **error** under `libs/`.
- Nx module boundaries enforce layering (`scope:protocol < transport < sdk < app`) and keep Node-only code out of the Angular bundle (`platform:browser` may only depend on `platform:shared`).
- Hot path: span emission is a preallocated ring-buffer write; ids come from `crypto.getRandomValues`; time from `performance.now()`; clock/ids injected for deterministic tests.

## Zero-touch guarantee (spec's defining constraint)

Client code changes are exactly one module import:

```ts
@Module({
  imports: [EventTracerModule.forRoot({
    serviceName: 'order-service',
    tenantId: 'acme',
    transport: { kafka: { brokers: ['localhost:9092'] } },
    redaction: { allowlist: ['orderId'] },
  })],
})
export class AppModule {}
```

Handlers stay pure business logic. The acceptance test
(`libs/transport-core/src/lib/trace-chain.spec.ts`) proves a 3-service chain
produces one connected trace — `null → S1 → S2 → S3` — with zero tracing code
in the "services"; `libs/sdk-nestjs/src/lib/event-tracer.module.spec.ts`
proves the same through the NestJS module.

## Test map (89 tests)

| Project | Suites | What they pin down |
|---|---|---|
| `protocol` (49) | ids, traceparent, span-event, redaction | W3C parse strictness, header precedence, strict schema rejections, status⟺error invariant, prototype-pollution defense, brand-level type errors |
| `transport-core` (18) | emitter, base-transport, chain, capabilities, ALS | drop-newest under saturation, sink-failure recovery, parent chaining, error rethrow + ERROR span, redaction, wiring-time capability failure |
| `transport-kafka` (12) | header codec, transport, sink | record.headers mapping, group naming, DLQ content + at-least-once rethrow, req/reply happy path + timeout, separate tracing client |
| `sdk-nestjs` (10) | module, interceptor, serializer | zero-touch chain via DI, wiring-time failures, ALS through lazy `next.handle()`, producer span chaining in the serializer |

## Commands

```bash
nvm use 22                                   # Node 18 is too old for Angular 21
npx nx run-many -t lint,test,build --all     # the full gate
npx nx test transport-core                   # includes the chain acceptance test
npx nx graph                                 # protocol ← transport-core ← {kafka, sdk-nestjs}
```

## Phase 3 — Collector + DB (what was built)

**Data layer (`libs/storage`, `@ariadne/storage`)** — shared by the collector now and the Phase-4 API later; `TraceStore` is the seam a ClickHouse implementation would fill at very high volume.
- Drizzle schemas with the protocol's branded types on columns; `spans` PK `(tenant_id, span_id, start_time)` (Postgres requires the partition key in unique constraints), `traces` PK `(tenant_id, trace_id)` with a stored generated `duration_ms`.
- Migrations in `libs/storage/drizzle/`: `0000` traces (drizzle-kit generated), `0001` hand-written partitioned `spans` (daily range partitions, pre-created −7d…+90d, `spans_ensure_partition(date)` as the TTL-job seam — no DEFAULT partition), `0002` grant tightening. Run with `nx run storage:migrate` as the owner; the collector role cannot run DDL.
- `PgTraceStore.insertSpans` — one transaction per chunk: multi-row `INSERT … ON CONFLICT DO NOTHING … RETURNING` (first-write-wins = replay defense B2), then a commutative `traces` upsert (`COALESCE` root / `+` count / `LEAST`/`GREATEST` times / `OR` error) computed **only from RETURNING rows**, which keeps `span_count` exact under at-least-once redelivery. Rows sorted for deadlock-free concurrent replicas.

**Collector (`apps/collector`)** — consumes `_tracing` with raw kafkajs (deliberately not KafkaTransport: the collector must never trace itself into `_tracing`), group `eventtracer-collector-group`.
- Spec's "100 spans or 500 ms" realized at the broker fetch (`minBytes` + `maxWaitTimeInMs: 500`) plus ≤100-span write chunks; `eachBatchAutoResolve: false` and offsets resolve only after the chunk's transaction commits. Nothing buffers in-process — not consuming IS the backpressure when the DB is down.
- Ingestion gate (B1): pre-parse 64 KiB size guard → `JSON.parse` → `parseSpanEvent` (strict zod) → span-age window (`now−7d … now+1d`, matching the partition range) so an attacker-controlled `startTime` can never cause an INSERT-failure loop. Invalids are counted by reason and logged rate-limited (reason kinds only, never payload).
- DB-down: 5 bounded retries with heartbeats and exponential backoff, then rethrow → kafkajs restart → SIGTERM on non-restartable crash. Permanent (data) errors fall back to row-by-row so one poison span can't wedge a partition.
- `GET :3001/healthz` — kafka/db status + ingestion counters; graceful shutdown stops the consumer (awaiting the in-flight batch) before closing the pool.

**Infra** — `docker-compose.yml` (Kafka KRaft 3.9, Postgres 16, healthchecks) + `infra/postgres/init/01-roles.sql` (`eventtracer_collector` INSERT/UPDATE/SELECT, `eventtracer_reader` SELECT-only, default privileges for future tables).

**Smoke checklist** (needs Docker; see README for commands): seed via `tools/smoke/seed-tracing.mjs` → expect 2 `traces` rows (span_count 6, root `order-service`, one `has_error`), 12 `spans` rows, `/healthz` `spansInvalid ≥ 3`; re-running the seed changes nothing (idempotent replay); `DELETE FROM spans` as the collector role is denied (least privilege).

## Deferred (tracked, deliberately not built yet)

- Kafka: topic admin/auto-creation policy, retry-with-backoff before DLQ, `eachBatch` throughput mode, rebalance-safe req/reply, real-broker integration tests (arrive with docker-compose in Phase 3+).
- Serializer producer span measures serialize-time, not broker ack (Nest's `ClientKafka` owns the send); the Transport-port path (Surface A) times the real publish.
- OTLP/HTTP span sink (the `SpanSink` interface is the seam).
