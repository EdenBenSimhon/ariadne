import { traceIdSchema, type TraceId } from '@ariadne/protocol';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Input validation helpers (security B3): every query param is zod-bounded;
 * failures return issue paths + messages, never echoing raw values.
 */
export function parseQuery<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'validation failed',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export interface CursorPayload {
  readonly startTime: Date;
  readonly traceId: TraceId;
}

/** Opaque keyset cursor: base64url("<startTimeMs>:<traceId>"). */
export function encodeCursor(startTime: Date, traceId: TraceId): string {
  return Buffer.from(`${startTime.getTime()}:${traceId}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.indexOf(':');
  const startTimeMs = separator > 0 ? Number(decoded.slice(0, separator)) : Number.NaN;
  const traceId = traceIdSchema.safeParse(decoded.slice(separator + 1));
  if (!Number.isSafeInteger(startTimeMs) || !traceId.success) {
    throw new BadRequestException('invalid cursor');
  }
  return { startTime: new Date(startTimeMs), traceId: traceId.data };
}

export const windowQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type WindowQuery = z.infer<typeof windowQuerySchema>;

export interface ResolvedWindow {
  readonly from: Date;
  readonly to: Date;
}

/** Defaults the lookback and bounds the window size (query-cost cap, B3). */
export function resolveWindow(
  query: WindowQuery,
  bounds: { lookbackMs: number; maxWindowMs: number },
  nowMs = Date.now()
): ResolvedWindow {
  const to = query.to !== undefined ? new Date(query.to) : new Date(nowMs);
  const from =
    query.from !== undefined ? new Date(query.from) : new Date(to.getTime() - bounds.lookbackMs);
  if (from.getTime() > to.getTime()) {
    throw new BadRequestException('`from` must not be after `to`');
  }
  if (to.getTime() - from.getTime() > bounds.maxWindowMs) {
    throw new BadRequestException('requested time window is too large');
  }
  return { from, to };
}
