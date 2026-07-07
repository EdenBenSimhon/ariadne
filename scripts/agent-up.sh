#!/usr/bin/env bash
# Brings up the "Ask" AI agent so the UI can answer plain-language questions by
# reasoning over the EventTracer MCP tools with a local Ollama model.
#
#   ./scripts/agent-up.sh
#
# Prerequisites (not started here):
#   - Ollama running with a tools-capable model:  ollama serve && ollama pull llama3.1:8b
#   - The API (:3000) + collector running with trace data flowing
#     (e.g. via ./scripts/monitor-ecommerce.sh).
#
# What it does:
#   - builds the MCP server (the agent spawns dist/apps/mcp/main.js over stdio)
#   - serves the agent on :3300
#
# Then run the UI (npx nx serve ui) and open the "Ask" tab.
set -euo pipefail

ARIADNE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ARIADNE_DIR"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi

# Fail fast if Ollama isn't reachable — the agent needs it to reason.
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
if ! curl -sf "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
  echo "⚠️  Ollama not reachable at ${OLLAMA_URL}. Start it first: 'ollama serve' (and 'ollama pull llama3.1:8b')." >&2
  exit 1
fi

echo "▶ Building MCP server (agent spawns dist/apps/mcp/main.js)…"
npx nx build mcp

echo "▶ Serving agent on :${AGENT_PORT:-3300} …"
export MCP_ENTRY="${MCP_ENTRY:-$ARIADNE_DIR/dist/apps/mcp/main.js}"
exec npx nx serve agent
