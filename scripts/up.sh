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

step "1/8  Infrastructure (Kafka + RabbitMQ + Postgres)"
docker compose up -d
ok "compose up"

step "2/8  DB migrations"
npx nx run storage:migrate
ok "schema applied"

step "3/8  Ensure Kafka topics exist"
# On a fresh broker the collector and demo-mesh would otherwise race topic
# creation and crash with "does not host this topic-partition".
for topic in _tracing orders.created inventory.reserved; do
  docker compose exec -T kafka /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server localhost:9092 --create --if-not-exists \
    --topic "$topic" --partitions 1 --replication-factor 1 >/dev/null
done
ok "topics ready (_tracing, orders.created, inventory.reserved)"

step "4/8  Collector"
start collector npx nx serve collector
if wait_http "http://localhost:3001/healthz" 45; then ok "collector healthy (:3001)"; else warn "collector health timed out — check .run/logs/collector.log"; fi

step "5/8  API"
start api npx nx serve api
if wait_http "http://localhost:3000/api/healthz" 45; then ok "api healthy (:3000)"; else warn "api health timed out — check .run/logs/api.log"; fi

step "6/8  Demo mesh + UI"
start demo-mesh npx nx serve demo-mesh
start ui npx nx serve ui
sleep 5

step "7/8  AI agent (optional — needs Ollama)"
if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  npx nx build mcp >/dev/null   # the agent spawns dist/apps/mcp/main.js over stdio
  start agent npx nx serve agent
  if wait_http "http://localhost:3300/agent/health" 45; then
    ok "agent healthy (:3300) — the Ask tab is live"
  else
    warn "agent health timed out — check .run/logs/agent.log"
  fi
else
  warn "Ollama not running — skipping the agent (Ask tab will be offline)."
  warn "  enable it later: brew install ollama && ollama pull llama3.1:8b && npx nx serve agent"
fi

step "8/8  Fire one order → one cross-transport trace"
# demo-mesh's first webpack compile can take a while — retry until it answers.
ORDER_OK=""
for _ in $(seq 1 30); do
  if curl -sf -X POST localhost:4001/orders \
       -H 'content-type: application/json' -d '{"orderId":"ord-42"}' >/dev/null 2>&1; then
    ORDER_OK=1; break
  fi
  sleep 2
done
if [ -n "$ORDER_OK" ]; then
  ok "POST /orders accepted"
else
  warn "POST /orders never answered — check .run/logs/demo-mesh.log"
fi

step "UP"
ok "Stack is running. Give the collector ~2s to batch, then:"
echo "   • UI          → http://localhost:4200  (Logs = span search, Flows = drift, Ask = agent)"
echo "   • API traces  → curl -s -H 'x-tenant-id: acme' localhost:3000/api/traces | python3 -m json.tool"
echo "   • Collector   → http://localhost:3001/healthz"
echo "   • RabbitMQ UI → http://localhost:15672"
echo ""
echo "Stop everything with:  ./scripts/down.sh"
