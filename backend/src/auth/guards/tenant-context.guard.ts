import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../types/jwt-payload';

interface RequestShape {
  user?: AuthenticatedUser;
  headers?: Record<string, string | string[] | undefined>;
}

// Validates the X-Tenant-Id header against the caller's access.
//
// - SUPER_ADMIN: header (when present) must point to a real, active tenant — 404
//   otherwise. No membership required; they may enter any tenant.
// - Tenant users: header (when present) must match one of their memberships in an
//   active tenant — 403 otherwise. On success the request's role/tenantId are swapped
//   to that membership's, so downstream guards and services see the per-tenant role.
//
// A missing header is a no-op here — the @TenantId() decorator raises the error on
// routes that actually require a tenant context (403 for tenant users, 400 for
// SUPER_ADMIN). This guard runs before RolesGuard (see auth.module.ts).
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<RequestShape>();
    const user = req.user;
    if (!user) return true;

    const raw = req.headers?.['x-tenant-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value.length === 0) return true;

    if (user.role === UserRole.SUPER_ADMIN) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: value } });
      if (!tenant || !tenant.isActive) {
        throw new NotFoundException(`Tenant ${value} not found`);
      }
      return true;
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: value } },
      include: { tenant: { select: { isActive: true } } },
    });
    if (!membership || !membership.tenant.isActive) {
      throw new ForbiddenException('Not a member of this tenant');
    }
    user.role = membership.role;
    user.tenantId = value;
    return true;
  }
}
