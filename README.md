# ariadne
Transport-agnostic distributed tracing for event-driven and API-based systems — one trace across Kafka, RabbitMQ, and REST, with zero tracing code in your services.

See `docs/RUNBOOK.md` for how to run it, `docs/TUTORIAL.md` for the guided
walkthrough, `docs/IMPLEMENTATION.md` for what is built, and `CLAUDE.md` for
project rules.

## Quick start

```bash
git clone <repo> && cd ariadne
npm run setup     # installs Node 22 (via nvm), dependencies, builds everything
npm run up        # full live mesh (needs Docker): infra + migrations + services + agent + smoke order
# → open http://localhost:4200
npm run down      # stop everything
```

No Docker? `npm run demo` shows the flow-recognition engine on mock traces in
~30s, and the UI runs backend-free with `USE_MOCK_API = true`. The Ask agent
additionally needs Ollama (`brew install ollama && ollama pull llama3.1:8b`) —
`npm run up` detects it and starts the agent automatically when present.

All scripts handle `nvm use 22` for you (Node 18 is too old for Angular 21):

```bash
npm run setup     # one-command install (idempotent)
npm run verify    # Path A (no Docker): build + test all + MCP demos
npm run demo      # just the MCP flow-recognition demo + stdio probe
npm run up        # Path B (needs Docker): everything, including the agent
npm run down      # tear the Path B stack back down
```

## Path A — no Docker

```bash
nvm use 22
npx nx run-many -t lint,test,build --all    # the full gate (14 projects)
node tools/mcp-demo/complex-mesh.cjs        # MCP recognizes business flows from mock traces
npx nx serve ui                             # UI on :4200 (set USE_MOCK_API=true for data)
```

## Path B — full live mesh (Docker)

```bash
nvm use 22
docker compose up -d              # Kafka (KRaft) + RabbitMQ + Postgres 16 + least-privilege roles
npx nx run storage:migrate        # apply migrations as the dev owner
npx nx serve collector            # consumes _tracing → Postgres; health at :3001/healthz
npx nx serve api                  # REST API on :3000
npx nx serve demo-mesh            # order-service :4001 — zero tracing code

curl -s -X POST localhost:4001/orders -H 'content-type: application/json' -d '{"orderId":"ord-42"}'
# wait ~2s, then open the UI at http://localhost:4200 — the Live tab (/live) streams
# new traces in realtime over SSE (GET /api/events); MCP get_recent_activity reads the same feed

# or seed the worked example straight into _tracing (needs only Postgres + collector):
node tools/smoke/seed-tracing.mjs
docker compose exec postgres psql -U eventtracer_reader -d eventtracer \
  -c "SELECT trace_id, root_service, span_count, has_error, duration_ms FROM traces ORDER BY start_time"
```

## Workspace

```bash
npx nx run-many -t lint,test,build --all    # the full gate
npx nx graph                                # project dependency graph
```
