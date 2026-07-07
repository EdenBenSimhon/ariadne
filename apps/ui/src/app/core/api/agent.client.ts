import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** One turn the model took: which MCP tool it called and whether it succeeded. */
export interface AgentStep {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly ok: boolean;
}

export interface AgentAnswer {
  readonly answer: string;
  readonly steps: AgentStep[];
  readonly traceIds: string[];
}

/** A minimal chat turn we replay back to the agent for follow-up context. */
export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/**
 * Talks to apps/agent (proxied at /agent), which reasons over the EventTracer
 * MCP tools with a local Ollama model. No tenant header needed — the agent is
 * env-bound to the acme tenant server-side.
 */
@Injectable({ providedIn: 'root' })
export class AgentClient {
  private readonly http = inject(HttpClient);

  ask(question: string, history: ChatTurn[] = []): Observable<AgentAnswer> {
    return this.http.post<AgentAnswer>('/agent/ask', { question, history });
  }
}
