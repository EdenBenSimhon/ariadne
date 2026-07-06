import { HttpResponse, type HttpInterceptorFn } from '@angular/common/http';
import { isDevMode } from '@angular/core';
import { of } from 'rxjs';
import {
  FIXTURE_STATS,
  FIXTURE_TOPOLOGY,
  FIXTURE_TRACE_DETAIL,
  FIXTURE_TRACE_LIST,
} from './fixtures';

/**
 * Flip to true to develop the UI without the API/collector stack running —
 * every /api/* request is answered from the fixtures. Dev mode only.
 */
export const USE_MOCK_API = false;

function resolveMock(url: string): unknown {
  const path = url.split('?')[0] ?? url;
  if (/^\/api\/traces\/[0-9a-f]{32}$/.test(path)) return FIXTURE_TRACE_DETAIL;
  if (path === '/api/traces') return FIXTURE_TRACE_LIST;
  if (path === '/api/topology') return FIXTURE_TOPOLOGY;
  if (path === '/api/stats') return FIXTURE_STATS;
  return undefined;
}

export const mockApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!USE_MOCK_API || !isDevMode() || !req.url.startsWith('/api')) return next(req);
  const body = resolveMock(req.url);
  if (body === undefined) return next(req);
  return of(new HttpResponse({ status: 200, body }));
};
