/**
 * EventTracer MCP server (Phase-7 seed, spec §9): read-only, tenant-scoped
 * tools over the DISTILLED trace graph, spoken over stdio. Point an MCP
 * client (e.g. Claude Code) at it:
 *
 *   { "command": "node", "args": ["dist/apps/mcp/main.js"],
 *     "env": { "MCP_API_URL": "http://localhost:3000/api", "MCP_TENANT_ID": "acme" } }
 *
 * The rule (spec §9): algorithms distill structure; the agent reasons over
 * it. Raw spans and payload metadata never cross this boundary.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ApiClient, loadMcpConfig } from './app/api-client';
import { mcpTools } from './app/tools';

async function main(): Promise<void> {
  const client = new ApiClient(loadMcpConfig());
  const server = new Server(
    { name: 'eventtracer', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpTools.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = mcpTools.find((candidate) => candidate.name === request.params.name);
    if (tool === undefined) {
      return {
        content: [{ type: 'text', text: `unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(client, request.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  });

  await server.connect(new StdioServerTransport());
  // stdio server runs until the client disconnects; stderr is the log channel.
  console.error('eventtracer MCP server ready (stdio)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
