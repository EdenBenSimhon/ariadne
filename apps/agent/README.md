# EventTracer Agent (`apps/agent`)

A small, **fully local / offline** NestJS service that lets you _ask_ your system
plain-language questions ("what business flows run here?", "what's failing?") and get
answers grounded in real trace data.

It is:

- an **MCP client** — it spawns the EventTracer MCP server (`apps/mcp`) over stdio and
  calls its 7 read-only, distilled-graph tools; and
- an **Ollama client** — it drives a local LLM (`llama3.1:8b` by default) in a bounded
  tool-use loop.

```
UI (Ask page) ──POST /agent/ask──▶ apps/agent (:3300)
                                     ├─ MCP client (stdio) ─▶ apps/mcp ─▶ API :3000
                                     └─ Ollama client ──────▶ http://localhost:11434
```

## Endpoints

| Method | Path            | Body                                   | Returns                                  |
| ------ | --------------- | -------------------------------------- | ---------------------------------------- |
| POST   | `/agent/ask`    | `{ question, history? }`               | `{ answer, steps[], traceIds[] }`        |
| GET    | `/agent/health` | —                                      | `{ ready, tools[] }`                     |

`steps[]` lists each MCP tool the model invoked (`{ tool, args, ok }`); `traceIds[]` are
any 32-hex trace ids cited in the tool output, which the UI links to `/traces/:id`.

## Configuration (env)

| Var                        | Default                         | Purpose                                  |
| -------------------------- | ------------------------------- | ---------------------------------------- |
| `AGENT_PORT`               | `3300`                          | HTTP port                                |
| `OLLAMA_URL`               | `http://localhost:11434`        | Ollama daemon                            |
| `OLLAMA_MODEL`             | `llama3.1:8b`                   | Tools-capable model                      |
| `MCP_API_URL`              | `http://localhost:3000/api`     | EventTracer API the MCP server reads     |
| `MCP_TENANT_ID`            | `acme`                          | Tenant the MCP server is bound to        |
| `MCP_ENTRY`                | `dist/apps/mcp/main.js`         | Built MCP server entry the agent spawns  |
| `AGENT_MAX_TOOL_ITERATIONS`| `5`                             | Tool-loop budget                         |
| `OLLAMA_TIMEOUT_MS`        | `120000`                        | Per-chat timeout                         |

## Prerequisites

1. **Ollama** running with a tools-capable model:
   ```bash
   ollama serve            # if not already running
   ollama pull llama3.1:8b # tools-capable
   ```
2. The **MCP server built** (the agent spawns `dist/apps/mcp/main.js`):
   ```bash
   npx nx build mcp
   ```
3. The **API** (`:3000`) and **collector** (`:3001`) running with data flowing (e.g. from
   the instrumented `ecommerce-kafka` app — see `../../.. /ecommerce-kafka/INTEGRATION.md`).

## Run

```bash
nvm use 22
npx nx build mcp        # produce dist/apps/mcp/main.js (agent spawns it)
npx nx serve agent      # http://localhost:3300/agent
```

Then serve the UI (`npx nx serve ui`) and open the **Ask** tab, or hit it directly:

```bash
curl -s -X POST localhost:3300/agent/ask \
  -H 'content-type: application/json' \
  -d '{"question":"What business flows run here?"}' | jq
```

If `MCP_ENTRY` is a relative path, run the agent from the repo root (or pass an absolute
path) so it can find `dist/apps/mcp/main.js`.

## How it works

1. On boot, `McpClientService` spawns `apps/mcp`, calls `listTools()`, and captures the
   server's own `instructions` (reused as part of the system prompt).
2. `AgentService.ask()` sends the question + system prompt + the MCP tools (each tool's
   JSON-Schema `inputSchema` maps directly to an Ollama `function.parameters`).
3. When the model returns `tool_calls`, each is executed via MCP `callTool`, results are
   appended as `role: "tool"` messages, and the loop repeats up to
   `AGENT_MAX_TOOL_ITERATIONS`. A final no-tools turn forces an answer if the budget runs
   out.

Everything is local: no API keys, no network egress. The agent only ever sees the
**distilled** graph the MCP tools expose — never raw payloads.
