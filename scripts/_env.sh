#!/usr/bin/env bash
# Shared setup for the run scripts: locate the repo root, load Node 22 via nvm,
# and expose small helpers. Sourced by the other scripts — not run directly.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Load Node 22 through nvm when present (the shell often defaults to 18).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi

NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/v([0-9]+).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  echo "⚠  Node ${NODE_MAJOR:-?} detected — this project needs Node 22. Run 'nvm use 22' first." >&2
fi

# colored logging
c_reset='\033[0m'; c_cyan='\033[36m'; c_green='\033[32m'; c_yellow='\033[33m'; c_dim='\033[2m'
say()  { printf "${c_cyan}▸ %s${c_reset}\n" "$*"; }
ok()   { printf "${c_green}✓ %s${c_reset}\n" "$*"; }
warn() { printf "${c_yellow}◆ %s${c_reset}\n" "$*"; }
step() { printf "\n${c_cyan}══ %s ══${c_reset}\n" "$*"; }

RUN_DIR="$ROOT/.run"
LOG_DIR="$RUN_DIR/logs"
PID_FILE="$RUN_DIR/pids"

# wait_http URL [attempts] — poll until it answers 2xx/3xx, or give up
wait_http() {
  local url="$1" tries="${2:-60}" i
  for ((i = 1; i <= tries; i++)); do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
