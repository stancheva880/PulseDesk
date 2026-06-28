import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { resolveTenantId } from './tenant-id.decorator';
import type { AuthenticatedUser } from '../types/jwt-payload';

interface RequestShape {
  user?: AuthenticatedUser;
  headers?: Record<string, string | string[] | undefined>;
}

function makeContext(req: RequestShape): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('resolveTenantId (TenantId decorator factory)', () => {
  it('returns the JWT tenantId for tenant users', () => {
    const ctx = makeContext({
      user: { id: 'u', email: 'a@b', role: UserRole.ADMIN, tenantId: 'tenant-1' },
      headers: {},
    });
    expect(resolveTenantId(ctx)).toBe('tenant-1');
  });

  it('ignores X-Tenant-Id header for tenant users (cannot spoof tenant)', () => {
    const ctx = makeContext({
      user: { id: 'u', email: 'a@b', role: UserRole.ADMIN, tenantId: 'real-tenant' },
      headers: { 'x-tenant-id': 'forged-tenant' },
    });
    expect(resolveTenantId(ctx)).toBe('real-tenant');
  });

  it('throws Forbidden when the request has no authenticated user', () => {
    const ctx = makeContext({ user: undefined, headers: {} });
    expect(() => resolveTenantId(ctx)).toThrow(ForbiddenException);
  });

  it('throws Forbidden when a tenant user has no tenantId on their JWT (data inconsistency)', () => {
    const ctx = makeContext({
      user: { id: 'u', email: 'a@b', role: UserRole.ADMIN, tenantId: null },
      headers: {},
    });
    expect(() => resolveTenantId(ctx)).toThrow(ForbiddenException);
  });

  it('returns the X-Tenant-Id header value for SUPER_ADMIN', () => {
    const ctx = makeContext({
      user: { id: 'u', email: 'sa@x', role: UserRole.SUPER_ADMIN, tenantId: null },
      headers: { 'x-tenant-id': 'tenant-7' },
    });
    expect(resolveTenantId(ctx)).toBe('tenant-7');
  });

  it('throws BadRequest for SUPER_ADMIN when X-Tenant-Id is missing', () => {
    const ctx = makeContext({
      user: { id: 'u', email: 'sa@x', role: UserRole.SUPER_ADMIN, tenantId: null },
      headers: {},
    });
    expect(() => resolveTenantId(ctx)).toThrow(BadRequestException);
  });

  it('throws BadRequest for SUPER_ADMIN when X-Tenant-Id is an empty string', () => {
    const ctx = makeContext({
      user: { id: 'u', email: 'sa@x', role: UserRole.SUPER_ADMIN, tenantId: null },
      headers: { 'x-tenant-id': '' },
    });
    expect(() => resolveTenantId(ctx)).toThrow(BadRequestException);
  });
});
