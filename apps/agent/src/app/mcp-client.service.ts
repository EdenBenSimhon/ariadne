import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AGENT_CONFIG, type AgentConfig } from './config/agent-config';

export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/**
 * The agent as a first-class MCP client: it spawns the EventTracer MCP server
 * (apps/mcp) over stdio and calls its read-only, distilled-graph tools. This
 * keeps the spec §9 boundary — the agent reasons over distilled structure the
 * MCP server exposes, never raw spans.
 */
@Injectable()
export class McpClientService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(McpClientService.name);
  private client: Client | undefined;
  private transport: StdioClientTransport | undefined;
  private tools: McpToolInfo[] = [];
  private instructions = '';

  constructor(@Inject(AGENT_CONFIG) private readonly config: AgentConfig) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.connect();
    } catch (err) {
      this.logger.error(
        `MCP connect failed (will retry on first request): ${errMessage(err)}`
      );
    }
  }

  async connect(): Promise<void> {
    if (this.client) return;
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [this.config.mcpEntry],
      env: {
        ...(process.env as Record<string, string>),
        MCP_API_URL: this.config.mcpApiUrl,
        MCP_TENANT_ID: this.config.mcpTenantId,
      },
      stderr: 'inherit',
    });
    const client = new Client(
      { name: 'eventtracer-agent', version: '0.1.0' },
      { capabilities: {} }
    );
    await client.connect(this.transport);
    const listed = await client.listTools();
    this.tools = listed.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));
    this.instructions = client.getInstructions() ?? '';
    this.client = client;
    this.logger.log(
      `MCP connected — ${this.tools.length} tools: ${this.tools.map((t) => t.name).join(', ')}`
    );
  }

  isReady(): boolean {
    return this.client !== undefined && this.tools.length > 0;
  }

  getTools(): readonly McpToolInfo[] {
    return this.tools;
  }

  getInstructions(): string {
    return this.instructions;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    if (!this.client) throw new Error('MCP client not connected');
    const result = await this.client.callTool({ name, arguments: args });
    const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
    return content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
  }

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.client?.close();
    } catch {
      /* best-effort */
    }
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
