import { HttpClient, httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import {
  alertEventAckUrl,
  alertEventsUrl,
  alertRuleUrl,
  alertRulesUrl,
} from '../../core/api/api-urls';
import type {
  AlertEventsResponse,
  AlertRule,
  AlertRuleKind,
  AlertRulesResponse,
} from '../../core/api/api.types';
import { formatTime } from '../../shared/format';

const KINDS: readonly { kind: AlertRuleKind; label: string; hint: string }[] = [
  { kind: 'error-rate', label: 'error rate', hint: 'fires when the error rate exceeds a threshold' },
  { kind: 'latency-p95', label: 'p95 latency', hint: 'fires when p95 latency exceeds a limit' },
  { kind: 'flow-missing', label: 'flow missing', hint: 'fires when a business flow stops running' },
  { kind: 'flow-drift', label: 'flow drift', hint: 'fires when any flow appears/disappears/changes' },
  { kind: 'service-silent', label: 'service silent', hint: 'fires when a service stops producing spans' },
];

/** Rule management + fired-event feed for the alerting engine. */
@Component({
  selector: 'app-alerts-page',
  templateUrl: './alerts-page.html',
  styleUrl: './alerts-page.scss',
})
export class AlertsPage {
  private readonly http = inject(HttpClient);
  protected readonly kinds = KINDS;

  readonly rules = httpResource<AlertRulesResponse>(() => alertRulesUrl());
  readonly events = httpResource<AlertEventsResponse>(() => alertEventsUrl(50));

  readonly ruleItems = computed(() => this.rules.value()?.items ?? []);
  readonly eventItems = computed(() => this.events.value()?.items ?? []);

  // Create-rule form state
  readonly name = signal('');
  readonly kind = signal<AlertRuleKind>('error-rate');
  readonly threshold = signal('0.1');
  readonly thresholdMs = signal('1000');
  readonly windowMinutes = signal('15');
  readonly windowHours = signal('24');
  readonly service = signal('');
  readonly signature = signal('');
  readonly webhookUrl = signal('');
  readonly saving = signal(false);
  readonly formError = signal('');

  setKind(value: string): void {
    this.kind.set((KINDS.find((k) => k.kind === value)?.kind ?? 'error-rate') as AlertRuleKind);
  }

  create(): void {
    const config = this.buildConfig();
    if (config === null || this.name().trim().length === 0) {
      this.formError.set('fill in the rule name and the highlighted fields');
      return;
    }
    this.saving.set(true);
    this.formError.set('');
    const body: Record<string, unknown> = { name: this.name().trim(), kind: this.kind(), config };
    if (this.webhookUrl().trim().length > 0) body['webhookUrl'] = this.webhookUrl().trim();
    this.http.post(alertRulesUrl(), body).subscribe({
      next: () => {
        this.saving.set(false);
        this.name.set('');
        this.rules.reload();
      },
      error: () => {
        this.saving.set(false);
        this.formError.set('rule rejected — check the config values');
      },
    });
  }

  toggle(rule: AlertRule): void {
    this.http
      .patch(alertRuleUrl(rule.ruleId), { enabled: !rule.enabled })
      .subscribe({ next: () => this.rules.reload() });
  }

  remove(ruleId: string): void {
    this.http.delete(alertRuleUrl(ruleId)).subscribe({ next: () => this.rules.reload() });
  }

  ack(eventId: string): void {
    this.http.post(alertEventAckUrl(eventId), {}).subscribe({ next: () => this.events.reload() });
  }

  configSummary(rule: AlertRule): string {
    return Object.entries(rule.config)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' · ');
  }

  private buildConfig(): Record<string, string | number> | null {
    const windowMinutes = Number(this.windowMinutes()) || 15;
    switch (this.kind()) {
      case 'error-rate': {
        const threshold = Number(this.threshold());
        return Number.isFinite(threshold) && threshold >= 0 && threshold <= 1
          ? { threshold, windowMinutes }
          : null;
      }
      case 'latency-p95': {
        const thresholdMs = Number(this.thresholdMs());
        return Number.isFinite(thresholdMs) && thresholdMs > 0
          ? { thresholdMs: Math.floor(thresholdMs), windowMinutes }
          : null;
      }
      case 'flow-missing':
        return this.signature().trim().length > 0
          ? { signature: this.signature().trim(), windowMinutes: Math.max(windowMinutes, 5) }
          : null;
      case 'flow-drift':
        return { windowHours: Number(this.windowHours()) || 24 };
      case 'service-silent':
        return this.service().trim().length > 0
          ? { service: this.service().trim(), windowMinutes: Math.max(windowMinutes, 5) }
          : null;
    }
  }

  protected readonly formatTime = formatTime;
}
