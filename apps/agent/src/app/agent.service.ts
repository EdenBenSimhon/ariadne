import { Inject, Injectable, Logger } from '@nestjs/common';
import { AGENT_CONFIG, type AgentConfig } from './config/agent-config';
import { McpClientService } from './mcp-client.service';
import { OllamaService, type OllamaMessage, type OllamaTool } from './ollama.service';

export interface AskStep {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly ok: boolean;
}

export interface AskResult {
  readonly answer: string;
  readonly steps: AskStep[];
  readonly traceIds: string[];
}

const TRACE_ID_RE = /\b[0-9a-f]{32}\b/g;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly mcp: McpClientService,
    private readonly ollama: OllamaService,
    @Inject(AGENT_CONFIG) private readonly config: AgentConfig
  ) {}

  isReady(): boolean {
    return this.mcp.isReady();
  }

  toolNames(): string[] {
    return this.mcp.getTools().map((t) => t.name);
  }

  async ask(question: string, history: OllamaMessage[] = []): Promise<AskResult> {
    if (!this.mcp.isReady()) {
      // Lazy (re)connect — the MCP server may not have been up at boot.
      await this.mcp.connect();
    }

    const tools = this.mcp.getTools().map(toOllamaTool);
    const messages: OllamaMessage[] = [
      { role: 'system', content: this.systemPrompt() },
      ...history,
      { role: 'user', content: question },
    ];

    const steps: AskStep[] = [];
    const traceIds = new Set<string>();

    for (let i = 0; i < this.config.maxToolIterations; i++) {
      const message = await this.ollama.chat(messages, tools);
      messages.push(message);

      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        return { answer: message.content ?? '', steps, traceIds: [...traceIds] };
      }

      for (const call of calls) {
        const name = call.function?.name ?? 'unknown';
        const args = normalizeArgs(call.function?.arguments);
        let ok = true;
        let content: string;
        try {
          content = await this.mcp.callTool(name, args);
          for (const id of content.match(TRACE_ID_RE) ?? []) traceIds.add(id);
        } catch (err) {
          ok = false;
          content = `tool error: ${err instanceof Error ? err.message : String(err)}`;
          this.logger.warn(`tool ${name} failed: ${content}`);
        }
        steps.push({ tool: name, args, ok });
        messages.push({ role: 'tool', tool_name: name, content });
      }
    }

    // Iteration budget spent — force a final answer with no tools available.
    const closing = await this.ollama.chat(
      [
        ...messages,
        {
          role: 'user',
          content:
            'Stop calling tools. Using the tool results above, give your best final answer now.',
        },
      ],
      []
    );
    return { answer: closing.content ?? '', steps, traceIds: [...traceIds] };
  }

  private systemPrompt(): string {
    const mcpInstructions = this.mcp.getInstructions();
    return [
      'You are the EventTracer assistant. You help engineers understand the behaviour of a',
      'distributed system by calling the provided tools, which return DISTILLED trace data',
      '(service hops, timings, statuses) — never raw payloads.',
      '',
      'Rules:',
      '- Prefer calling a tool over guessing. For "what business flows/processes run here?"',
      '  start with discover_business_flows. For failures use find_anomalies then',
      '  get_trace_flow on a failing trace. For "what just happened" use get_recent_activity.',
      '- Call tools with minimal arguments; most take none.',
      '- After you have enough data, answer in clear prose: name each business flow, its',
      '  service→service hops and transport, frequency, error rate and typical latency.',
      '- Cite concrete trace ids when relevant. Be concise and concrete.',
      '',
      mcpInstructions ? `MCP server guidance:\n${mcpInstructions}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

export function toOllamaTool(tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): OllamaTool {
  const params =
    tool.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} };
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: params },
  };
}

function normalizeArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return {};
}
