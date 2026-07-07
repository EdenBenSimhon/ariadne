#!/usr/bin/env bash
# Path B — full live mesh (needs Docker). Brings up infra, migrates the DB,
# starts collector + api + demo-mesh + ui in the background, waits for health,
# fires one POST /orders, and prints where to look. Stop it with ./scripts/down.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker isn't running. Start Docker Desktop and re-run ./scripts/up.sh" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
: > "$PID_FILE"

# start NAME CMD... — run in background, record pid, log to file
start() {
  local name="$1"; shift
  say "starting $name (logs → .run/logs/$name.log)"
  ( "$@" >"$LOG_DIR/$name.log" 2>&1 & echo "$! $name" >>"$PID_FILE" )
}

step "1/6  Infrastructure (Kafka + RabbitMQ + Postgres)"
docker compose up -d
ok "compose up"

step "2/6  DB migrations"
npx nx run storage:migrate
ok "schema applied"

step "3/6  Collector"
start collector npx nx serve collector
if wait_http "http://localhost:3001/healthz" 45; then ok "collector healthy (:3001)"; else warn "collector health timed out — check .run/logs/collector.log"; fi

step "4/6  API"
start api npx nx serve api
if wait_http "http://localhost:3000/api/healthz" 45; then ok "api healthy (:3000)"; else warn "api health timed out — check .run/logs/api.log"; fi

step "5/6  Demo mesh + UI"
start demo-mesh npx nx serve demo-mesh
start ui npx nx serve ui
sleep 5

step "6/6  Fire one order → one cross-transport trace"
if curl -sf -X POST localhost:4001/orders \
     -H 'content-type: application/json' -d '{"orderId":"ord-42"}' >/dev/null 2>&1; then
  ok "POST /orders accepted"
else
  warn "POST /orders not ready yet — demo-mesh may still be starting (.run/logs/demo-mesh.log)"
fi

step "UP"
ok "Stack is running. Give the collector ~2s to batch, then:"
echo "   • UI          → http://localhost:4200"
echo "   • API traces  → curl -s -H 'x-tenant-id: acme' localhost:3000/api/traces | python3 -m json.tool"
echo "   • Collector   → http://localhost:3001/healthz"
echo "   • RabbitMQ UI → http://localhost:15672"
echo ""
echo "Stop everything with:  ./scripts/down.sh"
