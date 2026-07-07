import type { NextFunction, Request, Response } from 'express';

/**
 * Helmet-equivalent hardening without the dependency: the API serves JSON
 * (plus one SSE stream) to known frontends, so the policy is simply "this is
 * not a document" — no framing, no sniffing, no scripts, no caching.
 * HSTS is opt-in via config because compose runs plain HTTP.
 */
export function securityHeaders(enableHsts: boolean) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Cache-Control', 'no-store');
    if (enableHsts) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
