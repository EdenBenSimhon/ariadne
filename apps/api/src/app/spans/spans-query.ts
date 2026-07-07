import {
  channelSchema,
  serviceNameSchema,
  spanKindSchema,
  spanStatusSchema,
  transportKindSchema,
} from '@ariadne/protocol';
import { z } from 'zod';

export function makeSpansQuerySchema(maxPageSize: number, defaultPageSize: number) {
  return z.object({
    limit: z.coerce.number().int().min(1).max(maxPageSize).default(defaultPageSize),
    cursor: z.string().min(1).max(200).optional(),
    /** Free text over operation name, channel and error message. */
    q: z.string().min(1).max(200).optional(),
    service: serviceNameSchema.optional(),
    channel: channelSchema.optional(),
    status: spanStatusSchema.optional(),
    transport: transportKindSchema.optional(),
    spanKind: spanKindSchema.optional(),
    minDurationMs: z.coerce.number().int().min(0).max(86_400_000).optional(),
    metaKey: z.string().min(1).max(64).optional(),
    metaValue: z.string().min(1).max(256).optional(),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  });
}

export type SpansQuery = z.infer<ReturnType<typeof makeSpansQuerySchema>>;
