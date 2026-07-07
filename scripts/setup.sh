#!/usr/bin/env bash
# One-command install: Node 22 → dependencies → full build → preflight report.
# Safe to re-run any time; it only installs what is missing.
#
#   ./scripts/setup.sh          # or: npm run setup
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

c_reset='\033[0m'; c_cyan='\033[36m'; c_green='\033[32m'; c_yellow='\033[33m'
say()  { printf "${c_cyan}▸ %s${c_reset}\n" "$*"; }
ok()   { printf "${c_green}✓ %s${c_reset}\n" "$*"; }
warn() { printf "${c_yellow}◆ %s${c_reset}\n" "$*"; }
step() { printf "\n${c_cyan}══ %s ══${c_reset}\n" "$*"; }

step "1/4  Node 22"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm install 22 >/dev/null 2>&1 || true
  nvm use 22 >/dev/null 2>&1 || true
fi
NODE_MAJOR="$(node -v 2>/dev/null | sed -E 's/v([0-9]+).*/\1/' || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  echo "✗ Node ${NODE_MAJOR:-?} found but this project needs Node 22." >&2
  echo "  Install nvm, then re-run this script:" >&2
  echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash" >&2
  exit 1
fi
ok "node $(node -v)"

step "2/4  Dependencies"
if [ -d node_modules ] && [ node_modules/.package-lock.json -nt package-lock.json ] 2>/dev/null; then
  ok "node_modules already up to date"
else
  # The known machine quirk: a root-owned ~/.npm/_cacache from a past
  # `sudo npm` breaks installs with EACCES — fall back to a local cache.
  if ! npm ci --no-audit --no-fund 2> >(tee /tmp/ariadne-npm-err >&2); then
    if grep -q "EACCES" /tmp/ariadne-npm-err 2>/dev/null; then
      warn "npm cache is root-owned — retrying with a local cache"
      npm ci --no-audit --no-fund --cache=/tmp/ariadne-npm-cache
    else
      exit 1
    fi
  fi
  ok "dependencies installed"
fi

step "3/4  Build all projects"
npx nx run-many -t build --all
ok "workspace builds"

step "4/4  Preflight for the optional stacks"
if docker info >/dev/null 2>&1; then
  ok "Docker running — 'npm run up' starts the full live mesh"
else
  warn "Docker not running — you can still use 'npm run demo' and the mock UI;"
  warn "  start Docker Desktop before 'npm run up' (Kafka/RabbitMQ/Postgres)"
fi
if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  if curl -sf http://localhost:11434/api/tags | grep -q "llama3.1"; then
    ok "Ollama running with llama3.1 — the Ask agent will work"
  else
    warn "Ollama is running but llama3.1 is missing — run: ollama pull llama3.1:8b"
  fi
else
  warn "Ollama not running — the Ask tab needs it: brew install ollama && ollama pull llama3.1:8b"
fi

printf "\n"
ok "setup complete — next steps:"
echo "   npm run demo     # 30s flow-recognition showcase, no infra needed"
echo "   npm run up       # full live mesh (needs Docker), UI on :4200"
echo "   npm run verify   # the full build+test gate"
