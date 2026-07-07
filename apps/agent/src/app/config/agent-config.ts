/**
 * Agent runtime config. All local/offline: the LLM is Ollama on localhost and
 * the tools come from the EventTracer MCP server (spawned over stdio).
 */
export interface AgentConfig {
  readonly port: number;
  readonly ollamaUrl: string;
  readonly ollamaModel: string;
  readonly mcpApiUrl: string;
  readonly mcpTenantId: string;
  /** Path to the built MCP server entry (node dist/apps/mcp/main.js). */
  readonly mcpEntry: string;
  readonly maxToolIterations: number;
  readonly ollamaTimeoutMs: number;
}

export const AGENT_CONFIG = Symbol('AGENT_CONFIG');

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    port: intFromEnv(env['AGENT_PORT'], 3300),
    ollamaUrl: env['OLLAMA_URL'] ?? 'http://localhost:11434',
    ollamaModel: env['OLLAMA_MODEL'] ?? 'llama3.1:8b',
    mcpApiUrl: env['MCP_API_URL'] ?? 'http://localhost:3000/api',
    mcpTenantId: env['MCP_TENANT_ID'] ?? 'acme',
    mcpEntry: env['MCP_ENTRY'] ?? 'dist/apps/mcp/main.js',
    maxToolIterations: intFromEnv(env['AGENT_MAX_TOOL_ITERATIONS'], 5),
    ollamaTimeoutMs: intFromEnv(env['OLLAMA_TIMEOUT_MS'], 120_000),
  };
}

function intFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
