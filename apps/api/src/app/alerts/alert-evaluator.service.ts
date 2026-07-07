import { randomUUID } from 'node:crypto';
import type { TenantId } from '@ariadne/protocol';
import type { AlertStore, StoredAlertRule, TraceReader } from '@ariadne/storage';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { FlowsService } from '../flows/flows.service';
import { ALERT_STORE, TRACE_READER } from '../storage/storage.module';
import { decide, type Observation, type Verdict } from './evaluate';

/**
 * The watch half of alerting: every tick, gather one Observation per enabled
 * rule and let the pure `decide()` call it. Firing is edge-triggered — the
 * rule's last_state must flip ok→breach for an event to be written (and the
 * webhook called), so a sustained outage is one incident, not one alert per
 * tick. Same in-process pattern as the live-events poller: no new
 * infrastructure, and a queue/scheduler can replace the setInterval later.
 */
@Injectable()
export class AlertEvaluatorService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(AlertEvaluatorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(ALERT_STORE) private readonly store: AlertStore,
    @Inject(TRACE_READER) private readonly reader: TraceReader,
    private readonly flows: FlowsService,
    @Inject(API_CONFIG) private readonly config: ApiConfig
  ) {}

  onModuleInit(): void {
    if (this.config.alertEvalMs === 0) return; // disabled (tests)
    this.timer = setInterval(() => void this.tick(), this.config.alertEvalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One evaluation pass over all enabled rules; also called by tests. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rules = await this.store.listAllEnabledRules();
      for (const rule of rules) {
        try {
          await this.evaluateRule(rule);
        } catch (err) {
          // One broken rule must not silence the rest.
          this.logger.warn(
            `rule ${rule.ruleId} (${rule.kind}) evaluation failed: ${err instanceof Error ? err.message : 'unknown'}`
          );
        }
      }
    } catch (err) {
      this.logger.warn(`alert tick failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      this.running = false;
    }
  }

  private async evaluateRule(rule: StoredAlertRule): Promise<void> {
    const tenantId = rule.tenantId;
    const verdict = decide(rule.config, await this.observe(tenantId, rule));
    // setRuleState returns false when the state did not change → no re-fire.
    const flipped = await this.store.setRuleState(tenantId, rule.ruleId, verdict.state);
    if (!flipped || verdict.state !== 'breach') return;

    await this.store.insertEvent(tenantId, {
      eventId: randomUUID(),
      ruleId: rule.ruleId,
      ruleName: rule.name,
      kind: rule.kind,
      message: verdict.message,
      context: verdict.context,
    });
    this.logger.warn(`ALERT [${tenantId}] ${rule.name}: ${verdict.message}`);
    if (rule.webhookUrl !== null) await this.notify(rule, verdict, tenantId);
  }

  private async observe(tenantId: TenantId, rule: StoredAlertRule): Promise<Observation> {
    const minutes = Number(rule.config['windowMinutes'] ?? 15);
    const window = { from: new Date(Date.now() - minutes * 60_000), to: new Date() };
    switch (rule.kind) {
      case 'error-rate': {
        const stats = await this.reader.getStats(tenantId, window);
        return {
          kind: 'error-rate',
          errorRate: stats.traceCount > 0 ? stats.errorTraceCount / stats.traceCount : 0,
          traceCount: stats.traceCount,
        };
      }
      case 'latency-p95': {
        const stats = await this.reader.getStats(tenantId, window);
        return { kind: 'latency-p95', p95DurationMs: stats.p95DurationMs };
      }
      case 'flow-missing': {
        const flows = await this.flows.flows(tenantId, { sampleSize: 100, ...window });
        const signature = String(rule.config['signature'] ?? '');
        return {
          kind: 'flow-missing',
          present: flows.flows.some((flow) => flow.signature === signature),
        };
      }
      case 'flow-drift': {
        const windowHours = Number(rule.config['windowHours'] ?? 24);
        const changes = await this.flows.changes(tenantId, { sampleSize: 100, windowHours });
        return {
          kind: 'flow-drift',
          changeCount: changes.changes.length,
          topReason: changes.changes[0]?.reasons[0] ?? null,
        };
      }
      case 'service-silent': {
        const services = await this.reader.listServiceSummaries(tenantId, window);
        const target = String(rule.config['service'] ?? '');
        const summary = services.find((entry) => entry.serviceName === target);
        return { kind: 'service-silent', spanCount: summary?.spanCount ?? 0 };
      }
      default:
        throw new Error(`unknown rule kind ${rule.kind}`);
    }
  }

  /** Slack-incoming-webhook-compatible payload; failures only log. */
  private async notify(
    rule: StoredAlertRule,
    verdict: Verdict,
    tenantId: TenantId
  ): Promise<void> {
    try {
      await fetch(rule.webhookUrl as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 [EventTracer] ${rule.name}: ${verdict.message}`,
          rule: rule.name,
          kind: rule.kind,
          tenantId,
          message: verdict.message,
          context: verdict.context,
          firedAt: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      this.logger.warn(
        `webhook for rule ${rule.ruleId} failed: ${err instanceof Error ? err.message : 'unknown'}`
      );
    }
  }
}
