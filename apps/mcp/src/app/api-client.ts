/**
 * Read-only client for the EventTracer REST API. The MCP server has exactly
 * the access scope of a user (spec §9): same RBAC-guarded endpoints, one
 * tenant, no writes.
 */
export interface McpConfig {
  readonly apiBaseUrl: string;
  readonly tenantId: string;
}

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  return {
    apiBaseUrl: env['MCP_API_URL'] ?? 'http://localhost:3000/api',
    tenantId: env['MCP_TENANT_ID'] ?? 'acme',
  };
}

export class ApiClient {
  constructor(private readonly config: McpConfig) {}

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      headers: { 'x-tenant-id': this.config.tenantId },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`EventTracer API ${path} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
