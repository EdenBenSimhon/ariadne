import { Inject, Injectable } from '@nestjs/common';
import { AGENT_CONFIG, type AgentConfig } from './config/agent-config';

export interface OllamaTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

export interface OllamaToolCall {
  readonly function: { readonly name: string; readonly arguments: Record<string, unknown> };
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  /** Set on role:'tool' messages so the model knows which tool answered. */
  tool_name?: string;
}

/**
 * Thin client over Ollama's /api/chat with tool-calling. No SDK, no key —
 * plain fetch to the local Ollama daemon.
 */
@Injectable()
export class OllamaService {
  constructor(@Inject(AGENT_CONFIG) private readonly config: AgentConfig) {}

  async chat(messages: OllamaMessage[], tools: OllamaTool[]): Promise<OllamaMessage> {
    const response = await fetch(`${this.config.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.config.ollamaModel,
        messages,
        tools,
        stream: false,
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(this.config.ollamaTimeoutMs),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Ollama /api/chat failed HTTP ${response.status}: ${body}`);
    }
    const data = (await response.json()) as { message?: OllamaMessage };
    return data.message ?? { role: 'assistant', content: '' };
  }
}
