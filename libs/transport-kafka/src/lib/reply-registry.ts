import type { Envelope } from '@ariadne/protocol';
import { RequestTimeoutError } from '@ariadne/transport-core';

interface PendingReply {
  resolve(envelope: Envelope): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** correlationId → pending request, for Kafka's emulated request/reply (spec §7). */
export class ReplyRegistry {
  private readonly pending = new Map<string, PendingReply>();

  register(correlationId: string, target: string, timeoutMs: number): Promise<Envelope> {
    return new Promise<Envelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(correlationId);
        reject(new RequestTimeoutError(target, timeoutMs));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(correlationId, { resolve, reject, timer });
    });
  }

  resolve(correlationId: string, envelope: Envelope): boolean {
    const entry = this.pending.get(correlationId);
    if (!entry) return false;
    this.pending.delete(correlationId);
    clearTimeout(entry.timer);
    entry.resolve(envelope);
    return true;
  }

  rejectAll(err: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
