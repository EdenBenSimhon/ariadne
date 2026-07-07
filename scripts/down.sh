#!/usr/bin/env bash
# Tear down whatever ./scripts/up.sh started: the background Nx servers and the
# Docker compose stack.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

step "Stopping background services"
if [ -f "$PID_FILE" ]; then
  while read -r pid name; do
    [ -z "${pid:-}" ] && continue
    if kill "$pid" 2>/dev/null; then ok "stopped $name (pid $pid)"; fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
else
  warn "no pid file — nothing recorded by up.sh"
fi

# Belt-and-suspenders: free the well-known dev ports if anything lingers.
for port in 4200 4001 3000 3001 3300; do
  lsof -ti "tcp:$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
done

step "Stopping Docker compose stack"
if docker info >/dev/null 2>&1; then
  docker compose down
  ok "compose down"
else
  warn "Docker not running — skipped compose down"
fi

ok "all stopped"
