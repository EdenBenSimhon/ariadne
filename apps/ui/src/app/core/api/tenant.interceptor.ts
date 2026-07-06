import type { HttpInterceptorFn } from '@angular/common/http';

/**
 * Interim tenancy: the API requires a validated x-tenant-id on every request
 * (no default server-side). Phase 6 replaces this constant with the
 * authenticated principal's tenant.
 */
export const DEFAULT_TENANT = 'acme';

export const tenantInterceptor: HttpInterceptorFn = (req, next) =>
  req.url.startsWith('/api')
    ? next(req.clone({ setHeaders: { 'x-tenant-id': DEFAULT_TENANT } }))
    : next(req);
