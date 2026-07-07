import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { AgentService } from './agent.service';
import type { OllamaMessage } from './ollama.service';

interface AskBody {
  question?: unknown;
  history?: unknown;
}

@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get('health')
  health() {
    return { ready: this.agent.isReady(), tools: this.agent.toolNames() };
  }

  @Post('ask')
  async ask(@Body() body: AskBody) {
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (question.length === 0) {
      throw new BadRequestException('question is required');
    }
    const history = sanitizeHistory(body?.history);
    return this.agent.ask(question, history);
  }
}

function sanitizeHistory(raw: unknown): OllamaMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: OllamaMessage[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string'
    ) {
      out.push({ role: item.role, content: item.content });
    }
  }
  // Keep the last few turns only, to bound the prompt.
  return out.slice(-8);
}
