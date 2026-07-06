import { BadRequestException } from '@nestjs/common';
import { tenantFromHeaders } from './tenant';

describe('tenantFromHeaders', () => {
  it('returns the branded tenant id from a valid header', () => {
    expect(tenantFromHeaders({ 'x-tenant-id': 'acme' })).toBe('acme');
  });

  it('rejects a missing header — no default tenant, ever', () => {
    expect(() => tenantFromHeaders({})).toThrow(BadRequestException);
  });

  it.each(['ACME', 'a b', '../etc', 'x'.repeat(65), ''])('rejects junk tenant %j', (value) => {
    expect(() => tenantFromHeaders({ 'x-tenant-id': value })).toThrow(BadRequestException);
  });

  it('takes the first value of a repeated header', () => {
    expect(tenantFromHeaders({ 'x-tenant-id': ['acme', 'evil'] })).toBe('acme');
  });
});
