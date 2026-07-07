#!/usr/bin/env bash
# Path A — no Docker. Builds & tests everything, then runs the MCP flow-
# recognition demo and the stdio-server probe. This is the full "does it work?"
# check that needs no infrastructure.
#
#   ./scripts/verify.sh            # full gate + demos
#   ./scripts/verify.sh --fresh    # re-run tests with no Nx cache (true count)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

FRESH=""
[ "${1:-}" = "--fresh" ] && FRESH="--skip-nx-cache"

step "1/4  Build + lint + test all projects"
npx nx run-many -t lint,test,build --all $FRESH
ok "workspace gate green"

step "2/4  Authoritative test count (fresh, no cache)"
COUNT="$(npx nx run-many -t test --all --skip-nx-cache 2>&1 \
  | sed -E 's/\x1b\[[0-9;]*m//g' | grep -E '^Tests:' \
  | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | awk '{s+=$1} END {print s}')"
ok "${COUNT:-?} unit tests passing"

step "3/4  MCP flow recognition on the complex mock mesh"
node tools/mcp-demo/complex-mesh.cjs

step "4/4  Probe the MCP stdio server (6 tools, fail-safe)"
node tools/mcp-demo/stdio-probe.cjs

step "DONE"
ok "Path A verified — no Docker required."
echo "Next: ./scripts/up.sh for the full live mesh (needs Docker), or 'npx nx serve ui' for the UI."
