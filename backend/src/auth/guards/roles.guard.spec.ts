import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../types/jwt-payload';
import { RolesGuard } from './roles.guard';

function makeContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function makeReflector(required: UserRole[] | undefined): Reflector {
  return {
    getAllAndOverride: (key: string) => (key === ROLES_KEY ? required : undefined),
  } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('returns true when no roles are required', () => {
    const guard = new RolesGuard(makeReflector(undefined));
    const ctx = makeContext({ id: 'u', email: 'a@b', role: UserRole.EMPLOYEE, tenantId: 't' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when no authenticated user is present', () => {
    const guard = new RolesGuard(makeReflector([UserRole.ADMIN]));
    const ctx = makeContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows users whose role is in the required list', () => {
    const guard = new RolesGuard(makeReflector([UserRole.ADMIN]));
    const ctx = makeContext({ id: 'u', email: 'a@b', role: UserRole.ADMIN, tenantId: 't' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects users whose role is not in the required list', () => {
    const guard = new RolesGuard(makeReflector([UserRole.ADMIN]));
    const ctx = makeContext({ id: 'u', email: 'a@b', role: UserRole.EMPLOYEE, tenantId: 't' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('always allows SUPER_ADMIN regardless of @Roles() metadata', () => {
    const guard = new RolesGuard(makeReflector([UserRole.ADMIN]));
    const ctx = makeContext({
      id: 'u',
      email: 'sa@local',
      role: UserRole.SUPER_ADMIN,
      tenantId: null,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows SUPER_ADMIN even when the required list does not include SUPER_ADMIN', () => {
    const guard = new RolesGuard(makeReflector([UserRole.EMPLOYEE, UserRole.CUSTOMER]));
    const ctx = makeContext({
      id: 'u',
      email: 'sa@local',
      role: UserRole.SUPER_ADMIN,
      tenantId: null,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
