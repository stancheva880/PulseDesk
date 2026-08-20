import {
  BadRequestException,
  createParamDecorator,
  ForbiddenException,
  type ExecutionContext,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../types/jwt-payload';

interface TenantRequest {
  user?: AuthenticatedUser;
  headers?: Record<string, string | string[] | undefined>;
}

// Resolves the tenantId for the current request. The active tenant travels in the
// X-Tenant-Id header for ALL users (PRD-0001):
// - Tenant users (ADMIN/EMPLOYEE/CUSTOMER): header required — 403 when missing/empty.
//   TenantContextGuard has already verified the header matches one of the caller's
//   memberships (and swapped the request role to that membership's).
// - SUPER_ADMIN: header required — 400 when missing/empty. TenantContextGuard has
//   already verified the header points to a real, active tenant.
export function resolveTenantId(ctx: ExecutionContext): string {
  const req = ctx.switchToHttp().getRequest<TenantRequest>();
  const user = req.user;
  if (!user) throw new ForbiddenException('No authenticated user');

  const raw = req.headers?.['x-tenant-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) {
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException('X-Tenant-Id header required for SUPER_ADMIN');
    }
    throw new ForbiddenException('X-Tenant-Id header required');
  }
  return value;
}

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => resolveTenantId(ctx),
);
