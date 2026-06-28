import {
  CanActivate,
  ExecutionContext,
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

// Validates the X-Tenant-Id header for SUPER_ADMIN requests. Tenant users are unaffected
// (their tenant comes from the JWT). If a SUPER_ADMIN sends a header pointing to a
// missing or inactive tenant, the request is rejected with 404 before the handler runs.
//
// If SUPER_ADMIN sends no header, this guard is a no-op — the @TenantId() decorator will
// raise 400 only on routes that actually require a tenant context.
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
    if (!user || user.role !== UserRole.SUPER_ADMIN) return true;

    const raw = req.headers?.['x-tenant-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || value.length === 0) return true;

    const tenant = await this.prisma.tenant.findUnique({ where: { id: value } });
    if (!tenant || !tenant.isActive) {
      throw new NotFoundException(`Tenant ${value} not found`);
    }
    return true;
  }
}
