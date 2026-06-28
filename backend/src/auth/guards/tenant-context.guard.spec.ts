import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types/jwt-payload';
import { TenantContextGuard } from './tenant-context.guard';

interface FakeTenant { id: string; isActive: boolean }

function makePrisma(tenants: Record<string, FakeTenant | undefined>) {
  return {
    tenant: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(tenants[where.id] ?? null),
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

  it('is a no-op for tenant users (does not query DB)', async () => {
    const guard = new TenantContextGuard(
      makeReflector(),
      makePrisma({}),
    );
    const ctx = makeContext({
      user: { id: 'u', email: 'a', role: UserRole.ADMIN, tenantId: 't' },
      headers: { 'x-tenant-id': 'whatever' },
    });
    expect(await guard.canActivate(ctx)).toBe(true);
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
