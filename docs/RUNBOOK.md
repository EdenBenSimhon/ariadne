# EventTracer — Runbook (how to build & run)

Quick operational reference. For the narrative walkthrough and zero-touch
instrumentation guide, see [`TUTORIAL.md`](./TUTORIAL.md).

> **Node 22 is required** (`nvm use 22` — Node 18 is too old for Angular 21).

There are two paths. **Path A needs no infrastructure** and is verified to work
as-is. **Path B** stands up the full live mesh and needs Docker.

## One-command scripts (`scripts/`)

Everything below is wrapped in scripts that also handle `nvm use 22` for you:

```bash
./scripts/verify.sh       # Path A: build + test all + MCP demos (no Docker)
./scripts/verify.sh --fresh   # same, but re-run tests with no Nx cache
./scripts/demo.sh         # just the MCP flow-recognition demo + stdio probe
./scripts/up.sh           # Path B: infra + migrate + all services + smoke order (needs Docker)
./scripts/down.sh         # tear the Path B stack back down
```

The manual steps that these scripts run are spelled out below.

---

## Path A — no Docker (build, test, MCP, UI)

```bash
cd ariadne
nvm use 22

# 1. build + test everything (14 projects, 248 tests)
npx nx run-many -t lint,test,build --all

# 2. watch the MCP recognize business flows from mock traces (9 flows, 8 anomalies)
node tools/mcp-demo/complex-mesh.cjs

# 3. probe the real MCP stdio server (boots, lists its 6 tools, fails safe)
node tools/mcp-demo/stdio-probe.cjs

# 4. run the UI (to show data without a backend, first set USE_MOCK_API = true
#    in apps/ui/src/app/core/api/mock-api.interceptor.ts)
npx nx serve ui          # → http://localhost:4200
```

## Path B — full live mesh (needs Docker) · the MVP "definition of done"

```bash
nvm use 22

# 1. infrastructure: Kafka (KRaft) + RabbitMQ + Postgres 16 + least-privilege roles
docker compose up -d

# 2. apply DB migrations as the owner (services never run DDL)
npx nx run storage:migrate

# 3-5. run the services (separate terminals, or append &)
npx nx serve collector   # consumes _tracing → Postgres · health :3001/healthz
npx nx serve api         # REST API · health :3000/api/healthz
npx nx serve demo-mesh   # order-service on :4001 — ZERO tracing code in handlers

# 6. one request → one connected 6-span trace across Kafka + RabbitMQ + REST
curl -s -X POST localhost:4001/orders \
  -H 'content-type: application/json' -d '{"orderId":"ord-42"}'

# 7. wait ~2s (collector batch window), then open the UI
npx nx serve ui          # → http://localhost:4200
```

**No brokers but want a trace in the UI?** Seed the spec's worked example straight
into `_tracing` (needs only Postgres + collector):

```bash
node tools/smoke/seed-tracing.mjs
curl -s -H 'x-tenant-id: acme' localhost:3000/api/traces | python3 -m json.tool
```

> Every API call needs an `x-tenant-id` header — there is **no default tenant**.

---

## Wire the MCP server into Claude (needs the API from Path B)

**One-click (Claude Code):** `cp .mcp.json.example .mcp.json` in the repo root,
then `npx nx build mcp`. Claude Code auto-connects the `eventtracer` server on
its next start. The server ships `instructions` that tell the agent which tool
to reach for, so it's usable without any extra prompting.

The seven read-only, tenant-scoped tools:

| Tool | Answers |
|---|---|
| `discover_business_flows` | "What business processes actually run here?" |
| `find_anomalies` | "What's broken and where?" (hotspots, cycles, slow hops, failing flows) |
| `get_recent_activity` | "What just happened / anything failing right now?" — the recent **logs** |
| `get_trace_flow` | one trace as hops + critical path + sanitized errors |
| `get_topology` | who talks to whom, over which channels |
| `list_traces`, `get_stats` | recent traces + tenant-wide health |

Manual config (Claude Code / Desktop) if you'd rather not use the example file:

```jsonc
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

Example prompt: *"Discover the business flows in my system, name them, tell me
which is failing most and where it breaks, and show me any errors in the recent
activity."*

---

## Ports & endpoints

| Service | Port | Endpoint |
|---|---|---|
| UI | 4200 | http://localhost:4200 |
| API | 3000 | `/api/traces`, `/topology`, `/stats`, `/flows`, `/anomalies`, `/events` (SSE), `/events/recent`, `/healthz` |
| UI **Live** tab | 4200 | http://localhost:4200/live — realtime SSE feed |
| Collector | 3001 | `/healthz` (kafka/db status + ingestion counters) |
| demo-mesh (order-service) | 4001 | `POST /orders` |
| Kafka | 9092 | broker (KRaft) |
| RabbitMQ | 5672 / 15672 | AMQP / management UI |
| Postgres | 5432 | `eventtracer` db |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node --version` shows 18 | `nvm use 22` (Angular 21 minimum) |
| `EACCES` on `~/.npm/_cacache` | `npm install --cache=/tmp/ariadne-npm-cache` |
| Nx build fails with bogus rootDir/dependency errors | `npx nx reset` |
| API returns 400 "tenant" | add `-H 'x-tenant-id: acme'` — no default tenant by design |
| UI shows no data | start the API (Path B) or set `USE_MOCK_API = true` |
