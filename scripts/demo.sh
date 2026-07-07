#!/usr/bin/env bash
# Quick showcase — just the MCP flow-recognition demo + stdio probe.
# No build, no Docker. Assumes 'npx nx build graph mcp' has run at least once
# (verify.sh does this); builds them if the dist artifacts are missing.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

if [ ! -f dist/libs/graph/src/index.js ] || [ ! -f dist/apps/mcp/main.js ]; then
  say "dist artifacts missing — building graph + mcp first"
  npx nx run-many -t build -p graph mcp
fi

step "MCP recognizes business flows (complex mock mesh)"
node tools/mcp-demo/complex-mesh.cjs

step "MCP stdio server (boots, lists tools, fails safe)"
node tools/mcp-demo/stdio-probe.cjs

ok "demo complete"
