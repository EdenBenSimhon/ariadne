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
    {
      capabilities: { tools: {} },
      instructions:
        'EventTracer traces one request across Kafka, RabbitMQ and REST. Ask about the ' +
        "system's behaviour in plain language — these tools answer over the DISTILLED trace " +
        'graph (service hops, timings, statuses), never raw spans or payloads.\n\n' +
        'Where to start:\n' +
        '• "What business processes run here?" → discover_business_flows\n' +
        '• "What just happened / anything failing now?" → get_recent_activity, list_traces\n' +
        '• "What is broken and where?" → find_anomalies, then get_trace_flow on a failing trace\n' +
        '• "How do services connect?" → get_topology · "How healthy is it?" → get_stats\n\n' +
        'Everything is read-only and scoped to one tenant. A good default loop: ' +
        'discover_business_flows → find_anomalies → get_trace_flow on an example of a failing flow.',
    }
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
