import type { AlertRuleKind } from '@ariadne/graph';
import { z } from 'zod';

/**
 * The decision half of alerting, kept pure so every rule kind is testable
 * without a database: the evaluator service gathers an Observation, this file
 * turns (config, observation) into ok/breach + a human-readable message.
 */

export const ruleConfigSchemas: Record<AlertRuleKind, z.ZodType> = {
  'error-rate': z.object({
    /** Breach when the window's trace error rate exceeds this (0..1). */
    threshold: z.number().min(0).max(1),
    windowMinutes: z.number().int().min(1).max(1_440).default(15),
  }),
  'latency-p95': z.object({
    thresholdMs: z.number().int().min(1).max(3_600_000),
    windowMinutes: z.number().int().min(1).max(1_440).default(15),
  }),
  'flow-missing': z.object({
    /** Exact flow signature that must keep appearing. */
    signature: z.string().min(1).max(2_000),
    windowMinutes: z.number().int().min(5).max(1_440).default(60),
  }),
  'flow-drift': z.object({
    windowHours: z.number().int().min(1).max(168).default(24),
  }),
  'service-silent': z.object({
    service: z.string().min(1).max(128),
    windowMinutes: z.number().int().min(5).max(1_440).default(30),
  }),
};

export const alertRuleKinds = Object.keys(ruleConfigSchemas) as AlertRuleKind[];

export type Observation =
  | { kind: 'error-rate'; errorRate: number; traceCount: number }
  | { kind: 'latency-p95'; p95DurationMs: number | null }
  | { kind: 'flow-missing'; present: boolean }
  | { kind: 'flow-drift'; changeCount: number; topReason: string | null }
  | { kind: 'service-silent'; spanCount: number };

export interface Verdict {
  readonly state: 'ok' | 'breach';
  readonly message: string;
  readonly context: Record<string, string | number>;
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function decide(config: Record<string, string | number>, obs: Observation): Verdict {
  switch (obs.kind) {
    case 'error-rate': {
      const threshold = Number(config['threshold'] ?? 0);
      // An empty window is "ok": no traffic is service-silent's job to catch.
      const breach = obs.traceCount > 0 && obs.errorRate > threshold;
      return {
        state: breach ? 'breach' : 'ok',
        message: `error rate ${pct(obs.errorRate)} ${breach ? 'exceeds' : 'within'} threshold ${pct(threshold)} (${obs.traceCount} traces)`,
        context: { errorRate: obs.errorRate, threshold, traceCount: obs.traceCount },
      };
    }
    case 'latency-p95': {
      const thresholdMs = Number(config['thresholdMs'] ?? 0);
      const breach = obs.p95DurationMs !== null && obs.p95DurationMs > thresholdMs;
      return {
        state: breach ? 'breach' : 'ok',
        message: `p95 latency ${obs.p95DurationMs ?? 0}ms ${breach ? 'exceeds' : 'within'} ${thresholdMs}ms`,
        context: { p95DurationMs: obs.p95DurationMs ?? 0, thresholdMs },
      };
    }
    case 'flow-missing': {
      const signature = String(config['signature'] ?? '');
      return {
        state: obs.present ? 'ok' : 'breach',
        message: obs.present
          ? 'flow is running'
          : `flow stopped running: ${signature.slice(0, 200)}`,
        context: { signature: signature.slice(0, 500) },
      };
    }
    case 'flow-drift': {
      const breach = obs.changeCount > 0;
      return {
        state: breach ? 'breach' : 'ok',
        message: breach
          ? `${obs.changeCount} business flow(s) changed${obs.topReason !== null ? ` — ${obs.topReason}` : ''}`
          : 'no flow drift',
        context: { changeCount: obs.changeCount },
      };
    }
    case 'service-silent': {
      const service = String(config['service'] ?? '');
      const breach = obs.spanCount === 0;
      return {
        state: breach ? 'breach' : 'ok',
        message: breach
          ? `service ${service} produced no spans in the window`
          : `service ${service} is active (${obs.spanCount} spans)`,
        context: { service, spanCount: obs.spanCount },
      };
    }
  }
}
