import { HEADERS, tenantIdSchema, type TenantId } from '@ariadne/protocol';
import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';

/**
 * Interim tenancy (until Phase-6 auth): the x-tenant-id header is REQUIRED
 * and validated — there is deliberately no default tenant, so data can never
 * silently mix. The Phase-6 auth guard only changes where the TenantId comes
 * from (a token claim instead of this header); controllers already receive a
 * branded TenantId, so nothing downstream moves. Rate limiting (B3) hooks
 * here as well.
 */
export function tenantFromHeaders(
  headers: Record<string, string | string[] | undefined>
): TenantId {
  const raw = headers[HEADERS.TENANT_ID];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) {
    throw new BadRequestException(`missing required header ${HEADERS.TENANT_ID}`);
  }
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`invalid ${HEADERS.TENANT_ID} header`);
  }
  return parsed.data;
}

export const Tenant = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  tenantFromHeaders(ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>().headers)
);
