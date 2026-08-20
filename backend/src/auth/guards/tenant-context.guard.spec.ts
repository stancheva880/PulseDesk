import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types/jwt-payload';
import { TenantContextGuard } from './tenant-context.guard';

interface FakeTenant { id: string; isActive: boolean }
interface FakeMembership { userId: string; tenantId: string; role: UserRole; tenantActive: boolean }

function makePrisma(
  tenants: Record<string, FakeTenant | undefined>,
  memberships: FakeMembership[] = [],
) {
  return {
    tenant: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(tenants[where.id] ?? null),
    },
    membership: {
      findUnique: ({
        where,
      }: {
        where: { userId_tenantId: { userId: string; tenantId: string } };
      }) => {
        const m = memberships.find(
          (mm) =>
            mm.userId === where.userId_tenantId.userId &&
            mm.tenantId === where.userId_tenantId.tenantId,
        );
        return Promise.resolve(
          m ? { role: m.role, tenant: { isActive: m.tenantActive } } : null,
        );
      },
    },
  } as unknown as ConstructorParameters<typeof TenantContextGuard>[1];
}

function makeReflector(isPublic = false): Reflector {
  return {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? isPublic : undefined),
  } as unknown as Reflector;
}

function makeContext(req: { user?: AuthenticatedUser; headers?: Record<string, string> }): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('TenantContextGuard', () => {
  it('allows public routes through unchanged', async () => {
    const guard = new TenantContextGuard(makeReflector(true), makePrisma({}));
    expect(await guard.canActivate(makeContext({}))).toBe(true);
  });

  // Behavior flip (PRD-0001 / TKT-0001): tenant users' X-Tenant-Id is validated
  // against their memberships, and the request role becomes the per-tenant role.
  it('allows a tenant user whose header matches an active membership and swaps role/tenantId', async () => {
    const guard = new TenantContextGuard(
      makeReflector(),
      makePrisma({}, [{ userId: 'u', tenantId: 't2', role: UserRole.EMPLOYEE, tenantActive: true }]),
    );
    const user: AuthenticatedUser = { id: 'u', email: 'a', role: UserRole.ADMIN, tenantId: 't1' };
    const ctx = makeContext({ user, headers: { 'x-tenant-id': 't2' } });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(user.role).toBe(UserRole.EMPLOYEE);
    expect(user.tenantId).toBe('t2');
  });

  it('throws Forbidden for a tenant user whose header names a tenant they are not a member of', async () => {
    const guard = new TenantContextGuard(makeReflector(), makePrisma({}, []));
    const ctx = makeContext({
      user: { id: 'u', email: 'a', role: UserRole.ADMIN, tenantId: 't1' },
      headers: { 'x-tenant-id': 'forged' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws Forbidden for a tenant user whose membership tenant is inactive', async () => {
    const guard = new TenantContextGuard(
      makeReflector(),
      makePrisma({}, [{ userId: 'u', tenantId: 't2', role: UserRole.ADMIN, tenantActive: false }]),
    );
    const ctx = makeContext({
      user: { id: 'u', email: 'a', role: UserRole.ADMIN, tenantId: 't1' },
      headers: { 'x-tenant-id': 't2' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is a no-op for a tenant user without an X-Tenant-Id header (decorator enforces presence)', async () => {
    const guard = new TenantContextGuard(makeReflector(), makePrisma({}));
    const user: AuthenticatedUser = { id: 'u', email: 'a', role: UserRole.ADMIN, tenantId: 't' };
    const ctx = makeContext({ user, headers: {} });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(user.role).toBe(UserRole.ADMIN);
  });

  it('is a no-op for SUPER_ADMIN when X-Tenant-Id is missing', async () => {
    const guard = new TenantContextGuard(makeReflector(), makePrisma({}));
    const ctx = makeContext({
      user: { id: 'u', email: 'sa', role: UserRole.SUPER_ADMIN, tenantId: null },
      headers: {},
    });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('allows SUPER_ADMIN with a valid, active X-Tenant-Id', async () => {
    const guard = new TenantContextGuard(
      makeReflector(),
      makePrisma({ 't1': { id: 't1', isActive: true } }),
    );
    const ctx = makeContext({
      user: { id: 'u', email: 'sa', role: UserRole.SUPER_ADMIN, tenantId: null },
      headers: { 'x-tenant-id': 't1' },
    });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('throws NotFound for SUPER_ADMIN with an unknown X-Tenant-Id', async () => {
    const guard = new TenantContextGuard(makeReflector(), makePrisma({}));
    const ctx = makeContext({
      user: { id: 'u', email: 'sa', role: UserRole.SUPER_ADMIN, tenantId: null },
      headers: { 'x-tenant-id': 'missing' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound for SUPER_ADMIN with an inactive tenant', async () => {
    const guard = new TenantContextGuard(
      makeReflector(),
      makePrisma({ 't1': { id: 't1', isActive: false } }),
    );
    const ctx = makeContext({
      user: { id: 'u', email: 'sa', role: UserRole.SUPER_ADMIN, tenantId: null },
      headers: { 'x-tenant-id': 't1' },
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
  });
});
