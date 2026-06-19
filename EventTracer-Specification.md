**S O F T W A R E  S P E C I F I C A T I O N  ·  מ ס מ ך  א י פ י ו ן** 

## **EventTracer** 

## **Unified Architecture & Design Specification** 

Transport-agnostic distributed tracing for event-driven and API-based systems. One trace across Kafka, RabbitMQ, and REST — with the client writing no tracing code. 

_For any development company that wants to see how its data actually flows._ 

**==> picture [414 x 36] intentionally omitted <==**

**----- Start of picture text -----**<br>
TypeScript Python Java / Spring Kafka · RabbitMQ · REST LLM Agent Angular 21<br>Docker · K8s Security by Layer<br>**----- End of picture text -----**<br>


Version 3.1 · June 2026 · This document consolidates and supersedes the prior briefs (v1–v3) into a single specification, grounded in the original EventTracer design (May 2026). It adds the unified, multi-language client-integration model. 

EVENTTRACER — UNIFIED SPECIFICATION 

PURPOSE & CONTENTS 

## **Purpose & Scope** 

This is the single source of truth for EventTracer. It builds directly on the original May 2026 design — keeping its trace headers, span-event schema, collector batching, two-table database, API surface, and UI views — and generalizes that Kafka-only design into a transport-agnostic system with a unified, multi-language integration model. 

**Relationship to the original document.** Where the original assumed Kafka, this spec lifts the same protocol onto a neutral transport abstraction. The collector, database, and UI from the original carry over essentially unchanged. Sections that reproduce original content are marked _"from the original design."_ 

## **Contents** 

|**1 · The Problem & the Solution**|the invisible chain|
|---|---|
|**2 · Layered Architecture**|five layers at a glance|
|**3 · Layer 1 — Tracing Protocol**|headers, span schema, spans-per-hop|
|**4 · Layer 2 — Transport Abstraction (core)**|port, BaseTransport, capability matrix|
|**5 · Integration Model**|zero-touch / wrap / inherit — client writes no spans|
|**6 · Client Integration by Language**|TypeScript, Python, Java, generic manual|
|**7 · Per-Transport Implementation**|Kafka · RabbitMQ · REST|
|**8 · Layer 3 — The System**|collector, database, API, UI|
|**9 · Layer 4 — Intelligence (Agent)**|reasoning over the graph|
|**10 · Security Layer**|five trust boundaries|
|**11 · Stack, Algorithms, Platform**|technologies and scale|
|**12 · Roadmap, MVP & Open Decisions**|build order and what to settle first|



EventTracer · Unified Specification v3.1 

Purpose & Contents 

EVENTTRACER — UNIFIED SPECIFICATION 

1 · PROBLEM & SOLUTION 

## **1 · The Problem & the Solution** 

## **The problem (from the original design)** 

When `order-service` publishes an event that triggers `inventory-service` , which triggers `payment-service` , which triggers `order-service` again — there is no way to see this chain. Each service knows only about its own piece. The business process is real, but no one can observe it end-to-end. 

## **The solution** 

A lightweight protocol — trace headers on messages — plus an external system that collects and visualizes the full flow. The original design delivered this for Kafka. This specification makes it work over **any** transport (Kafka, RabbitMQ, REST), so that a single company running a mix of message brokers and HTTP APIs sees one connected trace, and an AI agent explains the emergent business choreography on top of it. 

**The defining constraint.** The customer never writes tracing code. They install an SDK and add configuration; trace propagation and span emission happen underneath their business logic. This is preserved across every supported language (Section 6). 

## **Who it is for** 

Any engineering organization that wants to observe its own data flows without rewriting services or locking into one messaging technology. Drop in the transport library, and every hop — REST, Kafka, RabbitMQ — joins the same end-to-end trace, rendered as a live graph and explained by the agent. 

## **Worked example — one request, six spans (from the original design)** 

A single `POST /orders` produces a chain of spans. Each service that consumes a message and produces the next creates two spans (one CONSUMER, one PRODUCER): 

|**#**|**KIND**|**SERVICE**|**CHANNEL**|**PARENT**|
|---|---|---|---|---|
|1|PRODUCER|order-service|orders.created|null|
|2|CONSUMER|inventory-service|orders.created|S1|
|3|PRODUCER|inventory-service|inventory.reserved|S2|
|4|CONSUMER|payment-service|inventory.reserved|S3|
|5|PRODUCER|payment-service|payment.completed|S4|
|6|CONSUMER|order-service|payment.completed|S5|



The `parentSpanId` chain ( `null → S1 → S2 → S3 → S4 → S5` ) is what lets the system reconstruct the tree. 

EventTracer · Unified Specification v3.1 

1 · Problem & Solution 

EVENTTRACER — UNIFIED SPECIFICATION 

2 · LAYERED ARCHITECTURE 

## **2 · Layered Architecture** 

Four stacked layers plus one cross-cutting Security layer. The **Transport Abstraction Layer** is the technical heart — it is what makes "any environment, any language" possible. **LAYER 4 — INTELLIGENCE AI Agent** Tool-using LLM. Queries traces, runs graph analysis, names & explains the emergent business choreography. Ste ▲ reads via the API (same access scope as a user) **LAYER 3 — SYSTEM EventTracer Platform** Standalone & decoupled: Collector → PostgreSQL → REST API → Angular UI. (From the original design.) ES ▲ every adapter publishes span events to `_tracing` **LAYER 2 — TRANSPORT ABSTRACTION** ★ **CORE One Port · Many Adapters · Any Language** A `Transport` port + a `BaseTransport` that injects trace context and emits spans for ALL environments. Adapters: Kafka · RabbitMQ · REST. Per-language SDKs wrap it (Section 6). ▲ implements the contract (carries the Envelope) _[Lee] ete **LAYER 1 — PROTOCOL Tracing Contract** Transport- and language-neutral: the Envelope (headers + payload + correlation) and the span-event schema. Any language can implement it. SS **CROSS-CUTTING** 🛡 **Security Layer** Wraps every boundary: trusted ingestion, encrypted storage, authenticated & tenant-isolated access, a hardened agent, a locked-down platform. (Section 10.) Wlsdédb€$b6btttta **The key split.** The original design fused "protocol + Kafka SDK." This spec separates them: the _protocol_ (Layer 1) is a pure contract; the _Transport Abstraction_ (Layer 2) realizes it once and adapts it to each environment and language. That single split is what turns a Kafka-only tracer into a tool any company can adopt. | 

EventTracer · Unified Specification v3.1 

2 · Layered Architecture 

EVENTTRACER — UNIFIED SPECIFICATION 

3 · LAYER 1 — PROTOCOL 

## **3 · Layer 1 — The Tracing Protocol** 

A contract, not code. The schema is from the original design; the only change is making the carrier neutral so HTTP, AMQP, and Kafka headers all hold the same fields. 

## **Trace context (Envelope headers)** 

|**HEADER**|**MEANING**|
|---|---|
|`x-trace-id`|Shared across the whole flow|
|`x-span-id`|This single operation|
|`x-parent-span-id`|The operation that triggered it|
|`x-service-name`|Who set the headers|
|`x-correlation-id`|Pairs a request with its reply|



Headers are metadata attached to the message, separate from the business payload. The payload is never modified. 

## **Span event →** **`_tracing`** 

## `{` 

```
"traceId":      "f47ac10b…",
"spanId":       "7c9e6679…",
```

```
"parentSpanId": "a1b2c3d4…",
"serviceName":  "inventory",
"spanKind":     "CONSUMER",
```

```
"transport":    "kafka",
```

```
"channel":      "orders.created",
```

```
"operationName":"handleOrderCreated",
```

```
"startTime":     "2026-05-31T10:00:00.050Z",
```

```
"durationMs":   70,
```

```
"status":       "OK",
```

```
"error":        null,
```

```
"metadata":     { "orderId":"ord-123" }
}
```

## **Field reference** 

|**FIELD**|**TYPE**|**DESCRIPTION**|
|---|---|---|
|`traceId`|UUID|Same across the entire flow|
|`spanId` /<br>`parentSpanId`|UUID / null|This op; link to parent (null = root)|
|`spanKind`|PRODUCER / CONSUMER|Publish or receive|
|`transport`|kafka / rabbitmq / rest|_New_— who carried the message|
|`channel`|string|_Renamed from_<br>`topic` — topic / routing key / route|
|`status` /<br>`error`|OK / ERROR / string|Outcome of the operation|
|`metadata`|object / null|Optional business context (redacted at source — Section 10)|



EventTracer · Unified Specification v3.1 

3 · Layer 1 — Protocol 

EVENTTRACER — UNIFIED SPECIFICATION 

4 · LAYER 2 — TRANSPORT ABSTRACTION 

## **4 ·** ★ **core Layer 2 — Transport Abstraction** 

Two universal communication patterns; many transports. Business code knows only the patterns. Each transport declares what it supports natively vs emulated — a mismatch fails loudly at wiring time, not at runtime. 

|**PATTERN**|**SHAPE**|**NATIVE HOME**|**EMULATED BY**|
|---|---|---|---|
|**Request / Reply**|`request(target, msg) →`|REST|Kafka/Rabbit via<br>`correlationId` + reply|
||`reply`||channel|
|**Publish /**|`publish(event)` /|Kafka,|REST via outbox + webhooks / polling|
|**Subscribe**|`subscribe(p, h)`|RabbitMQ||



## **The port + base class — inheritance where it belongs** 

Transports are not variants of one another, so they do not inherit from each other. They share one thing — trace injection and span emission — which lives in `BaseTransport` and is inherited once. What differs (how bytes leave the wire) is implemented through the interface. 

```
interface Transport {                  // the PORT business code depends on (via DI)
```

```
readonly caps: Capabilities;          // pubsub:'native'|'emulated'|'none', reqreply:…
  publish(e: Envelope): Promise<void>;
  subscribe(pattern: string, h: Handler): Subscription;
  request(target: string, e: Envelope): Promise<Envelope>;
}
```

```
abstract class BaseTransport implements Transport {   // shared behaviour — inherited ONCE
async publish(e: Envelope) {
```

```
const traced = this.injectTrace(e);    // x-trace-id, x-span-id, parent  (shared)
const span = this.startSpan('PRODUCER', traced);
try { await this.doPublish(traced); span.ok(); }
catch (err) { span.error(err); throw err; }
finally { this.emitSpan(span); }      // fire-and-forget → _tracing
  }
protected abstract doPublish(e: Envelope): Promise<void>;
protected abstract doSubscribe(p: string, h: Handler): Subscription;
}
```

```
class KafkaTransport  extends BaseTransport { doPublish(e){ /* kafkajs */ } }
class RabbitTransport extends BaseTransport { doPublish(e){ /* amqplib */ } }
class RestTransport   extends BaseTransport { doPublish(e){ /* HTTP */ } }
```

**Fail-safe rule:** the tracing producer is separate from the app's producer and is fire-and-forget with a bounded buffer + drop policy. If `_tracing` is slow or down, business logic must never block, slow, or crash. Non-negotiable. 

EventTracer · Unified Specification v3.1 

4 · Layer 2 — Transport Abstraction 

EVENTTRACER — UNIFIED SPECIFICATION 

5 · INTEGRATION MODEL 

## **5 · Integration Model** 

**The service developer writes zero spans, zero log calls, zero trace plumbing.** Tracing lives inside the SDK. The developer adopts it at one of three levels — identical conceptually in every language. 

**Zero-touch DEFAULT Wrap / Decorate MANUAL Inherit OPTIONAL** Install + config only. The SDK hooks One line — wrap the Extend `BaseTransport` only when the framework lifecycle. **No code** producer/consumer, or decorate a building a custom transport. Not the **changes.** handler. For setups the auto-hook default. can't reach. 

**Why inheritance is not the primary API.** Forcing `extends BaseTracer` on every service is the strongest coupling possible — TS and Java allow only one base class, and in Python most handlers are functions, not classes to subclass. The default everywhere is **composition / dependency injection** ; inheritance exists only inside our own code and as an escape hatch for new transports. 

## **How each language realizes the same model** 

|**LANGUAGE**|**PRODUCER HOOK**|**CONSUMER HOOK**|**CONTEXT CARRIER**|**EFFORT**|
|---|---|---|---|---|
|**TypeScript / NestJS**|Custom serializer|Global interceptor|AsyncLocalStorage|npm install + 1 import|
|**Python**|Wrapper / decorator|Wrapper / decorator|contextvars|pip install + wrap objects|
|**Java / Spring**|ProducerInterceptor|ConsumerInterceptor|ThreadLocal|Maven dep + 2 lines yaml|
|**Any other**|Manual: set headers + emit span||language-native|~10–20 lines|



This table is the original design's per-framework hook-points, extended with a generic row. Full code for each follows in Section 6. 

EventTracer · Unified Specification v3.1 

5 · Integration Model 

EVENTTRACER — UNIFIED SPECIFICATION 

6 · CLIENT INTEGRATION BY LANGUAGE 

## **6 · Client Integration by Language** 

The same model, the right mechanism per language. In every example the business logic is untouched — the SDK propagates context and emits spans automatically. 

## **TypeScript / NestJS** 

## **INTERCEPTOR + ASYNCLOCALSTORAGE** 

Zero-touch: install the package and import the module. A global interceptor (consumer) and a custom serializer (producer) are registered automatically; trace context flows through AsyncLocalStorage. 

**==> picture [487 x 201] intentionally omitted <==**

**----- Start of picture text -----**<br>
// app.module.ts — the ONLY change. Business handlers stay untouched.<br>import { EventTracerModule } from '@eventtracer/nestjs';<br>@Module({<br>  imports: [ EventTracerModule.forRoot({<br>    serviceName: 'order-service',<br>    transport:   { kafka: ['localhost:9092'] },<br>  }) ],<br>})<br>export class AppModule {}<br>// order.controller.ts — unchanged. No tracing code here.<br>@MessagePattern('orders.created')<br>handleOrderCreated(@Payload() data: OrderCreated) {<br>return this.orders.reserve(data);   // CONSUMER + downstream PRODUCER spans auto-emitted<br>}<br>**----- End of picture text -----**<br>


**Wrap fallback:** `const producer = tracer.wrap(kafka.producer());` — one line, no inheritance. 

## **Python** 

## **DECORATOR + CONTEXTVARS** 

Most Python handlers are functions, so the natural mechanism is a decorator or a wrapped client — never a base class. Context propagates through `contextvars` (async-safe). 

**==> picture [487 x 155] intentionally omitted <==**

**----- Start of picture text -----**<br>
# pip install eventtracer<br>from eventtracer import EventTracer<br>tracer = EventTracer(service_name="inventory-service",<br>                     transport={"kafka": ["localhost:9092"]})<br>producer = tracer.wrap(KafkaProducer(...))     # wrap → headers + PRODUCER span auto<br>@tracer.consume("orders.created")              # decorator → CONSUMER span auto<br>def handle_order_created(msg):<br>    reserve_stock(msg["orderId"])             # pure business logic<br>    producer.send("inventory.reserved", {"orderId": msg["orderId"]})<br>**----- End of picture text -----**<br>


Works the same for RabbitMQ ( `tracer.wrap(pika_channel)` ) and FastAPI/Flask (ASGI/WSGI middleware for REST). 

EventTracer · Unified Specification v3.1 

6 · Client Integration by Language 

EVENTTRACER — UNIFIED SPECIFICATION 

6 · CLIENT INTEGRATION BY LANGUAGE 

## **6 · Client Integration by Language (continued)** 

## **Java / Spring** 

## **INTERCEPTOR + THREADLOCAL** 

Spring Boot auto-configuration registers a `ProducerInterceptor` and a `ConsumerInterceptor` ; trace context is carried in a `ThreadLocal` . Add a Maven dependency and two lines of YAML. 

```
# application.yml — config only
eventtracer:
  service-name: payment-service
  transport: kafka://localhost:9092
// PaymentListener.java — unchanged. No tracing code.
@KafkaListener(topics = "inventory.reserved")
public void onReserved(InventoryReserved evt) {
    paymentService.charge(evt.getOrderId());   // CONSUMER span already emitted by interceptor
}
```

## **Any other language** 

## **GENERIC — MANUAL, ~10–20 LINES** 

Because Layer 1 is a contract, any language can implement it by hand. Two responsibilities: carry the headers, and emit a span. This is the fallback the original design promised. 

```
# ON PRODUCE
span = {
  traceId:      ctx.traceId  or uuid(),     # inherit or start a trace
  spanId:       uuid(),
  parentSpanId: ctx.spanId,                  # current span becomes the parent
  serviceName:  "my-service", spanKind: "PRODUCER",
  transport:    "kafka", channel: topic, startTime: now(),
}
msg.headers["x-trace-id"]       = span.traceId      # 1) stamp the message
msg.headers["x-span-id"]        = span.spanId
msg.headers["x-parent-span-id"] = span.parentSpanId
broker.send(topic, msg)                                  # 2) send business message
tracing.send("_tracing", json(span))                    # 3) emit span (fire-and-forget)
# ON CONSUME
ctx.traceId = msg.headers["x-trace-id"]
ctx.spanId  = uuid()
parentSpanId = msg.headers["x-span-id"]              # producer's span is our parent
emit_span(kind="CONSUMER", …)                          # same three steps, mirrored
```

**Invariant across all four:** the developer's business code is never edited for tracing. Spans are produced by the SDK (or by the 3 generic steps), and the `parentSpanId` chain is what stitches services — across languages and transports — into one trace. 

EventTracer · Unified Specification v3.1 

6 · Client Integration by Language 

EVENTTRACER — UNIFIED SPECIFICATION 

7 · PER-TRANSPORT IMPLEMENTATION 

## **7 · Per-Transport Implementation** 

Each adapter implements `doPublish` / `doSubscribe` / `doRequest` and maps trace headers to its native mechanism. Spans are emitted by `BaseTransport` for all three. 

## **Kafka** 

## **NATIVE: PUB/SUB** 

- **Trace carrier:** Envelope headers → Kafka `record.headers` . 

- **Subscribe:** consumer group per service; **partition key = entity id** (e.g. `orderId` ) for per-entity ordering. 

- **Request/Reply (emulated):** publish with `correlationId` + `replyTo` topic; await the matching reply. 

- **Delivery:** at-least-once → idempotent handlers (dedup by `spanId` ). Failures route to a DLQ topic. 

## **RabbitMQ** 

## **NATIVE: PUB/SUB + REQ/REPLY** 

**Trace carrier:** Envelope headers → AMQP `properties.headers` . 

- **Publish:** to a **topic / fanout exchange** ; subscribers bind queues with routing keys. 

- **Request/Reply (native):** AMQP **direct reply-to** (RPC) with `correlationId` — cleanest of the three. 

- **Backpressure:** consumer `prefetch` ; `ack` / `nack` with a Dead-Letter-Exchange. 

## **REST / HTTP API** 

## **NATIVE: REQ/REPLY** 

- **Trace carrier:** Envelope headers → HTTP request headers (or W3C `traceparent` ). 

- **Request/Reply (native):** a plain HTTP call; the reply _is_ the response. 

- **Pub/Sub (emulated):** "publish" writes to an **outbox** table; a dispatcher delivers via webhooks (or subscribers poll). `pubsub:'emulated'` . 

## **Capability matrix** 

|**TRANSPORT**|**PUB/SUB**|**REQ/REPLY**|**ORDERING**|**TRACE CARRIER**|
|---|---|---|---|---|
|**Kafka**|native|emulated|per-partition|record headers|
|**RabbitMQ**|native|native (RPC)|per-queue|AMQP headers|
|**REST**|emulated|native|n/a|HTTP headers|



EventTracer · Unified Specification v3.1 

7 · Per-Transport Implementation 

EVENTTRACER — UNIFIED SPECIFICATION 

8–9 · SYSTEM & INTELLIGENCE 

## **8 · Layer 3 — The System** 

## **FROM THE ORIGINAL DESIGN** 

## **Collector → PostgreSQL → REST API → Angular UI** 

- **Collector** — own consumer group `eventtracer-collector-group` ; batch-inserts (100 spans _or_ 500 ms); upserts the `traces` aggregate after each batch. Idempotent & order-independent (spans arrive out of order); upsert keyed by `spanId` . 

- **Database** — `spans` (raw; indexed on trace_id / service / time) + `traces` (pre-computed aggregate: root service, span count, duration, error flag) to avoid GROUP BY on listing. Time-partition + TTL; ClickHouse as a drop-in at very high volume. 

- **API** — `GET /api/traces` , `/api/traces/:id` (spans + pre-built DAG), `/api/topology` , `/api/stats` . 

- **UI (Angular 21)** — Timeline (bars on a time axis), Flow diagram (one trace as a DAG), Topology map (all traces aggregated; force-directed via D3; signals + zoneless updates). 

## **9 · Layer 4 — Intelligence (Agent)** 

## **THE DIFFERENTIATOR** 

## **An agent, not a prompt** 

**Rule:** algorithms distill structure; the agent reasons over it. Raw spans never reach the model — the distilled graph does. It uses read-only, scoped tools that call the same RBAC-guarded API a user would, then synthesizes. 

Discover & name business processes from observed choreography. 

- Explain decision points by aggregating path variants over thousands of traces. 

- Flag anomalies — unexpected cycles, dead branches, latency-dominant paths. 

- Generate living documentation from reality, not stale diagrams. 

EventTracer · Unified Specification v3.1 

8–9 · System & Intelligence 

EVENTTRACER — UNIFIED SPECIFICATION 

10 · SECURITY LAYER 

## **10 ·** 🛡 **Security Layer** 

EventTracer is a complete map of how a business operates — a high-value target. Security crosses every boundary; each gets its own controls. 

**==> picture [481 x 11] intentionally omitted <==**

**----- Start of picture text -----**<br>
B1 Ingestion Adapter → broker/HTTP<br>**----- End of picture text -----**<br>


**Transport identity:** mTLS + SASL (Kafka) / AMQP auth (Rabbit) / mTLS (REST). **Channel ACLs:** adapters may only write `_tracing` ; only the collector group reads it. **PII redaction at source:** `metadata` is an allowlist scrubbed in the adapter; payloads untouched. **Fail-safe:** span emission is fire-and-forget with a bounded buffer + drop policy. 

**==> picture [481 x 11] intentionally omitted <==**

**----- Start of picture text -----**<br>
B2 Storage Collector → PostgreSQL<br>**----- End of picture text -----**<br>


**Encryption** in transit + at rest; **least-privilege** DB role (INSERT/UPSERT only). **Retention & erasure:** TTL + deletion path (GDPR). **Replay defense:** idempotent upsert by `spanId` . 

**`B3` Access** `Clients → API` **AuthN:** OIDC / JWT. **AuthZ:** RBAC + tenant isolation — a team sees only its own services. _The crown-jewel boundary._ **Abuse limits:** rate limiting + query bounds. **Audit log:** who queried what, when. 

**==> picture [481 x 11] intentionally omitted <==**

**----- Start of picture text -----**<br>
B4 Intelligence Agent ↔ data + LLM<br>**----- End of picture text -----**<br>


**Trace data is untrusted input** → defend against indirect prompt injection (instruction/data separation, sanitization). **Read-only scoped tools;** keys in a secret manager; self-hosted model option for sensitive data. 

**`B5` Platform** `Kubernetes` **Default-deny NetworkPolicies** , secrets via Vault / sealed-secrets, non-root hardened pods, image scanning & signing in CI. 

**==> picture [49 x 8] intentionally omitted <==**

**----- Start of picture text -----**<br>
Kubernetes<br>**----- End of picture text -----**<br>


**The one rule:** the most dangerous path is `metadata` flowing untrusted into the agent. Sanitize at the adapter (B1), re-validate at the agent (B4). 

EventTracer · Unified Specification v3.1 

10 · Security Layer 

EVENTTRACER — UNIFIED SPECIFICATION 

11 · STACK, ALGORITHMS, PLATFORM 

## **11 · Stack, Algorithms & Platform** 

|**CONCERN**|**TECHNOLOGY**|**WHY**|
|---|---|---|
|Core<br>language|TypeScript|Transport core, collector, API, UI; shared types in<br>`libs/protocol`|
|Client SDKs|TypeScript · Python · Java (+<br>generic)|One model, native mechanism per language|
|Transports|Kafka · RabbitMQ · REST|Cover event-driven and API-based companies|
|Intelligence|LLM agent (tool use)|Reasons over the distilled graph|
|Storage / data|PostgreSQL (+ ClickHouse)|Two-table model; partitioning, retention, idempotent upserts at high<br>scale|
|Frontend|Angular 21 + D3|Signals, standalone components, zoneless updates for live graphs|
|Algorithms|BFS / DFS / topo-sort / clustering|The domain is a graph — the algorithms are the product|
|Local dev|Docker + docker-compose|Brokers, DB, demo mesh up with one command|
|Scale platform|Kubernetes (KEDA, Strimzi)|Autoscale collector on lag; brokers as operators|
|Monorepo|Nx|Shared libs;<br>`nx affected` builds only what changed|



## **Algorithmic core** 

|**CAPABILITY**|**ALGORITHM**|
|---|---|
|Reconstruction|tree/DAG from parent — BFS/DFS|
|Loop detection|DFS coloring|
|Critical path|topo-sort + DP|
|Topology agg.|merge DAGs → weighted graph|
|Path variants|signature + clustering|



## **Platform path** 

Build on **docker-compose** (Kafka, Rabbit, Postgres, demo mesh up with one command); finish the core; _then_ move to **Kubernetes** as the scale layer — KEDA autoscales the collector on `_tracing` lag, Strimzi runs Kafka. Each Nx app → one Compose service → one K8s Deployment. 

EventTracer · Unified Specification v3.1 

11 · Stack, Algorithms, Platform 

EVENTTRACER — UNIFIED SPECIFICATION 

12 · ROADMAP, MVP & OPEN DECISIONS 

## **12 · Roadmap, MVP & Open Decisions** 

## **1 Protocol + Envelope** 

Header set + span schema in `libs/protocol` . Everything depends on this. 

## **2 Transport core + Kafka adapter + TS SDK** 

`BaseTransport` (trace + span emission) and the zero-touch NestJS integration. _The core._ 

- **3 Collector + DB** 

Consume `_tracing` , batch-write spans + traces aggregate. Parallel with Phase 2. 

- **4 API + reconstruction** 

Trace endpoints + graph algorithms (DAG build, cycle detection). 

- **5 Angular 21 UI** 

Timeline, flow diagram, topology graph. End of the buildable MVP. 

## **6 RabbitMQ + REST adapters, Python + Java SDKs** 

Prove "any environment, any language" + Security baseline (B1–B3). 

## **7 AI agent** 

Tool-using agent over the API. Only after the core is solid. 

## **8 Kubernetes + high scale** 

KEDA, Strimzi, additional language SDKs, B4–B5 hardening. 

**MVP = Phases 1–6.** Definition of done: one request flowing through the demo mesh across all three transports produces a single connected trace, visible end-to-end in the UI, with the demo services containing _zero tracing code_ . 

## **Open decisions to settle before coding** 

|**DECISION**|**RECOMMENDATION**|
|---|---|
|Header format: custom<br>`x-*` vs W3C<br>`traceparent`|W3C-compatible — buys interop with the wider observability<br>ecosystem|
|Kafka req/reply reply-channel|Per-instance reply topic with<br>`correlationId` routing|
|Multi-tenancy from day one?|Decide now — it affects DB keys and RBAC; cheaper than retrofitting|
|Agent model: hosted vs self-hosted|Depends on trace-data sensitivity (Security B4)|



**Scope discipline:** the worst outcome is an ambitious build stalled at 40%. Ship Phases 1–6 as a coherent MVP before reaching for the agent or Kubernetes. 

EventTracer · Unified Specification v3.1 — end 

12 · Roadmap & Open Decisions 

