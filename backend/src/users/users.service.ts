import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, type User } from '@prisma/client';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

export type UserSummary = Omit<User, 'passwordHash'> & {
  locations: Array<{ id: string; name: string }>;
};

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
  locations: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly scope: LocationScopeService,
  ) {}

  /**
   * Lists users in the given tenant. ADMIN sees users at their assigned locations
   * (plus themselves); SUPER_ADMIN sees all users in the tenant.
   */
  async list(actor: AuthenticatedUser, tenantId: string): Promise<UserSummary[]> {
    const where: Prisma.UserWhereInput = { tenantId };
    if (actor.role === UserRole.ADMIN) {
      const allowedIds = (await this.scope.getAccessibleLocationIds(actor, tenantId)) ?? [];
      where.OR = [
        { id: actor.id },
        { locations: { some: { id: { in: allowedIds } } } },
      ];
    }
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { email: 'asc' }],
      select: USER_SELECT,
      take: DEFAULT_LIST_TAKE,
    });
    return rows;
  }

  /**
   * Lists SUPER_ADMIN users (tenantId = null). SUPER_ADMIN-only via the controller
   * @Roles annotation; this service method assumes that gate has been passed.
   */
  async listSuperAdmins(): Promise<UserSummary[]> {
    return this.prisma.user.findMany({
      where: { tenantId: null, role: UserRole.SUPER_ADMIN },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { email: 'asc' }],
      select: USER_SELECT,
      take: DEFAULT_LIST_TAKE,
    });
  }

  async findById(
    actor: AuthenticatedUser,
    tenantId: string | null,
    id: string,
  ): Promise<UserSummary> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (actor.role === UserRole.SUPER_ADMIN) return user;

    // Tenant users may only see users in their own tenant.
    if (user.tenantId !== actor.tenantId) {
      throw new NotFoundException(`User ${id} not found`);
    }
    if (actor.role === UserRole.ADMIN && user.id !== actor.id) {
      const allowedIds = (await this.scope.getAccessibleLocationIds(actor, actor.tenantId!)) ?? [];
      const hasIntersection = user.locations.some((l) => allowedIds.includes(l.id));
      if (!hasIntersection) throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async create(
    actor: AuthenticatedUser,
    tenantIdFromContext: string | null,
    dto: CreateUserDto,
  ): Promise<UserSummary> {
    // Determine the resolved tenantId for the new user based on the requested role.
    const targetTenantId = await this.resolveCreateTenantId(actor, tenantIdFromContext, dto);

    // Role-based permission checks.
    this.assertCanAssignRole(actor, dto.role);

    // ADMIN may only create users connected to their own assigned locations.
    if (actor.role === UserRole.ADMIN) {
      if (!dto.locationIds || dto.locationIds.length === 0) {
        throw new BadRequestException(
          'locationIds is required when ADMIN creates a tenant user',
        );
      }
      await this.scope.assertLocationsAllowed(actor, targetTenantId!, dto.locationIds);
    }

    // Validate locations belong to the tenant (when applicable).
    if (dto.locationIds && dto.locationIds.length > 0) {
      if (targetTenantId === null) {
        throw new BadRequestException('SUPER_ADMIN users cannot have locations');
      }
      await this.assertLocationsInTenant(targetTenantId, dto.locationIds);
    }

    const passwordHash = await this.auth.hashPassword(dto.password);

    try {
      const created = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          role: dto.role,
          tenantId: targetTenantId,
          locations:
            dto.locationIds && dto.locationIds.length > 0
              ? { connect: dto.locationIds.map((id) => ({ id })) }
              : undefined,
        },
        select: USER_SELECT,
      });
      return created;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(`Email "${dto.email}" already exists`);
      }
      throw e;
    }
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateUserDto,
  ): Promise<UserSummary> {
    const target = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!target) throw new NotFoundException(`User ${id} not found`);

    // Visibility check uses findById's logic (tenant + admin-scope).
    await this.findById(actor, target.tenantId, id);

    const isSelf = actor.id === id;
    const isActorSuper = actor.role === UserRole.SUPER_ADMIN;

    // Role changes are SUPER_ADMIN-only.
    if (dto.role !== undefined && !isActorSuper) {
      throw new ForbiddenException('Only SUPER_ADMIN can change a user role');
    }
    // ADMIN cannot edit SUPER_ADMIN users.
    if (target.role === UserRole.SUPER_ADMIN && actor.role === UserRole.ADMIN) {
      throw new ForbiddenException('ADMIN cannot modify SUPER_ADMIN users');
    }

    // Location reassignment rules.
    if (dto.locationIds !== undefined) {
      if (target.tenantId === null) {
        throw new BadRequestException('SUPER_ADMIN users cannot have locations');
      }
      await this.assertLocationsInTenant(target.tenantId, dto.locationIds);
      if (actor.role === UserRole.ADMIN) {
        await this.scope.assertLocationsAllowed(actor, target.tenantId, dto.locationIds);
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName ?? null;
    if (dto.lastName !== undefined) data.lastName = dto.lastName ?? null;
    if (dto.isActive !== undefined) {
      // Self-deactivation guard: SUPER_ADMIN cannot lock themselves out.
      if (isSelf && dto.isActive === false && isActorSuper) {
        throw new ForbiddenException('SUPER_ADMIN cannot deactivate themselves');
      }
      data.isActive = dto.isActive;
    }
    if (dto.password !== undefined) data.passwordHash = await this.auth.hashPassword(dto.password);
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.locationIds !== undefined) {
      data.locations = { set: dto.locationIds.map((lid) => ({ id: lid })) };
    }

    try {
      return await this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Email already exists');
      }
      throw e;
    }
  }

  async delete(actor: AuthenticatedUser, id: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, tenantId: true },
    });
    if (!target) throw new NotFoundException(`User ${id} not found`);

    if (actor.id === id) {
      throw new ForbiddenException('You cannot delete yourself');
    }

    if (actor.role === UserRole.ADMIN) {
      if (target.role === UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('ADMIN cannot delete SUPER_ADMIN users');
      }
      if (target.tenantId !== actor.tenantId) {
        throw new NotFoundException(`User ${id} not found`);
      }
      // ADMIN scope check via the regular visibility helper.
      await this.findById(actor, target.tenantId, id);
    }

    await this.prisma.user.delete({ where: { id } });
  }

  // --- helpers ---

  private async resolveCreateTenantId(
    actor: AuthenticatedUser,
    tenantIdFromContext: string | null,
    dto: CreateUserDto,
  ): Promise<string | null> {
    if (dto.role === UserRole.SUPER_ADMIN) {
      // Super admins are global — no tenant.
      if (actor.role !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenException('Only SUPER_ADMIN can create SUPER_ADMIN users');
      }
      return null;
    }

    // Tenant-scoped role being created.
    if (actor.role === UserRole.SUPER_ADMIN) {
      // SUPER_ADMIN must specify the target tenant via the X-Tenant-Id header
      // (resolved by the @TenantId decorator at the controller layer).
      if (!tenantIdFromContext) {
        throw new BadRequestException('X-Tenant-Id header required when creating tenant users');
      }
      return tenantIdFromContext;
    }

    // ADMIN — creates within their own tenant only.
    return actor.tenantId!;
  }

  private assertCanAssignRole(actor: AuthenticatedUser, role: UserRole): void {
    if (actor.role === UserRole.SUPER_ADMIN) return;
    if (actor.role === UserRole.ADMIN) {
      if (role === UserRole.SUPER_ADMIN || role === UserRole.ADMIN) {
        throw new ForbiddenException(`ADMIN cannot create ${role} users`);
      }
      return;
    }
    throw new ForbiddenException('Only ADMIN/SUPER_ADMIN may create users');
  }

  private async assertLocationsInTenant(
    tenantId: string,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const found = await this.prisma.location.count({
      where: { id: { in: [...ids] }, tenantId },
    });
    if (found !== ids.length) {
      throw new BadRequestException('Some locationIds are invalid or not in the tenant');
    }
  }
}
