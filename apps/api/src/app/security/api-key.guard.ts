import { timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';

interface GuardedRequest {
  readonly path?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly query?: Record<string, unknown>;
}

function headerValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Constant-time comparison — a plain === leaks key prefixes through timing. */
function keysMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Per-tenant API keys (Phase-6 auth, security B3). Keys come from API_KEYS
 * ("tenant:key,tenant:key"); when none are configured the guard is a no-op so
 * local dev needs zero setup. The tenant still comes from x-tenant-id — the
 * key proves the caller is ALLOWED to act as that tenant, closing the
 * pick-any-tenant hole the header alone leaves open.
 *
 * EventSource cannot set headers, so /events also accepts ?apiKey= —
 * acceptable for SSE because the stream carries distilled summaries only.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const tenants = Object.keys(this.config.apiKeys);
    if (tenants.length === 0) return true; // auth not configured (dev mode)

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const path = request.path ?? request.url;
    if (path.startsWith('/api/healthz')) return true; // liveness probes have no secrets

    const tenantId =
      headerValue(request.headers['x-tenant-id']) ??
      (typeof request.query?.['tenantId'] === 'string' ? request.query['tenantId'] : undefined);
    const presented =
      headerValue(request.headers['x-api-key']) ??
      (typeof request.query?.['apiKey'] === 'string' ? request.query['apiKey'] : undefined);

    const expected = tenantId !== undefined ? this.config.apiKeys[tenantId] : undefined;
    if (expected === undefined || presented === undefined || !keysMatch(expected, presented)) {
      throw new UnauthorizedException('missing or invalid api key');
    }
    return true;
  }
}
