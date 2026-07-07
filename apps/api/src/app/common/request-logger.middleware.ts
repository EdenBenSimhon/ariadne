import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('http');

/**
 * Structured access log with a per-request id. The id is echoed in
 * x-request-id (and by the exception filter) so a user-reported failure can
 * be matched to a server log line. Only method/path/status/latency are
 * logged — never query values or headers, which may carry tenant data.
 */
export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    (req as Request & { requestId: string }).requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const startNs = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startNs) / 1e6;
      const line = `${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms rid=${requestId}`;
      if (res.statusCode >= 500) logger.error(line);
      else if (res.statusCode >= 400) logger.warn(line);
      else logger.log(line);
    });
    next();
  };
}
