/**
 * Client for the EventTracer REST API. The MCP server has exactly the access
 * scope of a user (spec §9): same RBAC-guarded endpoints, one tenant. Reads
 * cover trace data; the ONLY write it can perform is POST /insights — the
 * agent persisting a conclusion — because that is the only write the API (and
 * its DB role) offers at all.
 */
export interface McpConfig {
  readonly apiBaseUrl: string;
  readonly tenantId: string;
  readonly apiKey?: string;
}

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  return {
    apiBaseUrl: env['MCP_API_URL'] ?? 'http://localhost:3000/api',
    tenantId: env['MCP_TENANT_ID'] ?? 'acme',
    ...(env['MCP_API_KEY'] !== undefined ? { apiKey: env['MCP_API_KEY'] } : {}),
  };
}

export class ApiClient {
  constructor(private readonly config: McpConfig) {}

  private headers(json = false): Record<string, string> {
    return {
      'x-tenant-id': this.config.tenantId,
      ...(this.config.apiKey !== undefined ? { 'x-api-key': this.config.apiKey } : {}),
      ...(json ? { 'content-type': 'application/json' } : {}),
    };
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`EventTracer API ${path} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`EventTracer API ${path} failed with HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
