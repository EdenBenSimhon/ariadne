# protocol

`@ariadne/protocol` — Layer 1 of EventTracer (spec §3). The transport- and
language-neutral tracing contract every other phase depends on: Envelope headers and
the span-event schema.

## What it exports

- **Constants:** `TRACE_HEADERS` (incl. `x-tenant-id`), `TRACING_CHANNEL` (`_tracing`),
  `SPAN_KINDS`, `TRANSPORTS`, `SPAN_STATUSES`.
- **Schemas + types (Zod, source of truth):** `SpanEventSchema` / `SpanEvent`,
  `EnvelopeSchema` / `Envelope`, `TraceContextSchema` / `TraceContext`.
- **Header codec:** `injectTraceContext(ctx)` → headers map (W3C `traceparent` +
  full-fidelity `x-*`), `extractTraceContext(headers)` → `TraceContext | null`.
- **Validation guards:** `parseSpanEvent(input)` (throws), `safeParseSpanEvent(input)`
  (returns `{ success, data | error }`).

Multi-tenancy is in the contract from day one: `tenantId` is required on every span and
carried via `x-tenant-id`.

## Phase 1 handoff — what downstream phases can assume

- **Phase 2 (transports / SDK):** `BaseTransport` injects context with
  `injectTraceContext` and reads inbound headers with `extractTraceContext`; the SDK
  supplies `serviceName` + `tenantId` once via config. Span ids are UUIDs; the codec
  also emits a W3C `traceparent` for ecosystem interop (its 8-byte span field is
  lossy — `x-span-id` / `x-parent-span-id` are authoritative).
- **Phase 3 (collector):** validate every `_tracing` event at the boundary with
  `safeParseSpanEvent` before persisting; `tenantId` is guaranteed present, so it can be
  a first-class column / key with no derivation or backfill.

## Building

Run `nx build protocol` to build the library.

## Running unit tests

Run `nx test protocol` to execute the unit tests via [Jest](https://jestjs.io). The suite
reconstructs the spec's canonical 6-span `POST /orders` trace end-to-end.

