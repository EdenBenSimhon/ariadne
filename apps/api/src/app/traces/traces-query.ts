import { serviceNameSchema } from '@ariadne/protocol';
import { z } from 'zod';

export function makeTracesQuerySchema(maxPageSize: number, defaultPageSize: number) {
  return z.object({
    limit: z.coerce.number().int().min(1).max(maxPageSize).default(defaultPageSize),
    cursor: z.string().min(1).max(200).optional(),
    /** Filters on the trace's ROOT service (an "involves service X" filter is a documented later seam). */
    service: serviceNameSchema.optional(),
    status: z.enum(['ok', 'error']).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  });
}

export type TracesQuery = z.infer<ReturnType<typeof makeTracesQuerySchema>>;
