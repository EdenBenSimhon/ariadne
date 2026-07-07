import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';

interface LimitedRequest {
  readonly path?: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

interface WindowState {
  count: number;
  windowStartMs: number;
}

const WINDOW_MS = 60_000;

/**
 * Fixed-window rate limiting per tenant (falling back to client IP), in
 * process memory (B3). Deliberately dependency-free: at EventTracer's API
 * fan-in a per-instance limiter is the right cost/benefit until a shared
 * store exists; the config knob (0 = off) keeps dev and tests unthrottled.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, WindowState>();

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const limit = this.config.rateLimitPerMinute;
    if (limit === 0) return true;

    const request = context.switchToHttp().getRequest<LimitedRequest>();
    const path = request.path ?? request.url;
    if (path.startsWith('/api/healthz')) return true;

    const tenantHeader = request.headers['x-tenant-id'];
    const tenant = Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader;
    const key = tenant ?? request.ip ?? request.socket?.remoteAddress ?? 'unknown';

    const now = Date.now();
    const state = this.windows.get(key);
    if (state === undefined || now - state.windowStartMs >= WINDOW_MS) {
      if (this.windows.size > 10_000) this.prune(now); // bound memory under key churn
      this.windows.set(key, { count: 1, windowStartMs: now });
      return true;
    }
    state.count += 1;
    if (state.count > limit) {
      throw new HttpException('rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private prune(now: number): void {
    for (const [key, state] of this.windows) {
      if (now - state.windowStartMs >= WINDOW_MS) this.windows.delete(key);
    }
  }
}
