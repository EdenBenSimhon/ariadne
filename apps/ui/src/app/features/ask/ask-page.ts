import {
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AgentClient,
  type AgentStep,
  type ChatTurn,
} from '../../core/api/agent.client';
import { shortId } from '../../shared/format';

interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly steps?: AgentStep[];
  readonly traceIds?: string[];
}

const SUGGESTIONS = [
  'What business flows run here?',
  'What is failing right now?',
  'What just happened in the system?',
  'Which services talk to each other?',
];

/** Cycled under the typing dots while the agent works, for a lively feel. */
const STATUS_MESSAGES = [
  'Thinking…',
  'Calling MCP tools…',
  'Reasoning over traces…',
  'Composing an answer…',
];

/**
 * "Ask" chat: plain-language questions answered by the local LLM agent driving
 * the EventTracer MCP tools. Shows which tools each answer used and links any
 * cited traces into the existing trace-detail view.
 */
@Component({
  selector: 'app-ask-page',
  imports: [FormsModule, RouterLink],
  templateUrl: './ask-page.html',
  styleUrl: './ask-page.scss',
})
export class AskPage implements OnDestroy {
  private readonly agent = inject(AgentClient);

  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly draft = signal('');
  protected readonly pending = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal(STATUS_MESSAGES[0]);

  private statusTimer: ReturnType<typeof setInterval> | undefined;

  protected readonly suggestions = SUGGESTIONS;
  protected readonly shortId = shortId;

  protected readonly canSend = computed(
    () => !this.pending() && this.draft().trim().length > 0
  );

  ngOnDestroy(): void {
    this.stopStatusCycle();
  }

  private startStatusCycle(): void {
    let i = 0;
    this.status.set(STATUS_MESSAGES[0]);
    this.stopStatusCycle();
    this.statusTimer = setInterval(() => {
      i = (i + 1) % STATUS_MESSAGES.length;
      this.status.set(STATUS_MESSAGES[i]);
    }, 1800);
  }

  private stopStatusCycle(): void {
    if (this.statusTimer !== undefined) {
      clearInterval(this.statusTimer);
      this.statusTimer = undefined;
    }
  }

  protected pick(suggestion: string): void {
    this.draft.set(suggestion);
    this.send();
  }

  protected send(): void {
    const question = this.draft().trim();
    if (question.length === 0 || this.pending()) return;

    const history: ChatTurn[] = this.messages().map((m) => ({
      role: m.role,
      content: m.content,
    }));

    this.messages.update((list) => [...list, { role: 'user', content: question }]);
    this.draft.set('');
    this.error.set(null);
    this.pending.set(true);
    this.startStatusCycle();

    this.agent.ask(question, history).subscribe({
      next: (res) => {
        this.messages.update((list) => [
          ...list,
          {
            role: 'assistant',
            content: res.answer,
            steps: res.steps,
            traceIds: res.traceIds,
          },
        ]);
        this.pending.set(false);
        this.stopStatusCycle();
      },
      error: (err) => {
        this.error.set(
          'The agent did not respond — is `nx serve agent` running (and Ollama up)?'
        );
        this.pending.set(false);
        this.stopStatusCycle();
        console.error('agent ask failed', err);
      },
    });
  }
}
