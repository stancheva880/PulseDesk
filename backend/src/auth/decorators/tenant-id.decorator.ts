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

// Resolves the tenantId for the current request.
// - Tenant users (ADMIN/EMPLOYEE/CUSTOMER): always returns the JWT tenantId. Any
//   X-Tenant-Id header sent by these users is ignored — they cannot spoof tenant context.
// - SUPER_ADMIN: reads tenantId from the X-Tenant-Id request header. Missing/empty → 400.
//   The TenantContextInterceptor validates the header points to a real, active tenant
//   before this decorator runs.
export function resolveTenantId(ctx: ExecutionContext): string {
  const req = ctx.switchToHttp().getRequest<TenantRequest>();
  const user = req.user;
  if (!user) throw new ForbiddenException('No authenticated user');

  if (user.role === UserRole.SUPER_ADMIN) {
    const raw = req.headers?.['x-tenant-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException('X-Tenant-Id header required for SUPER_ADMIN');
    }
    return value;
  }

  if (!user.tenantId) {
    throw new ForbiddenException('Tenant context required');
  }
  return user.tenantId;
}

export const TenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => resolveTenantId(ctx),
);
