import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, type User } from '@prisma/client';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import {
  buildPaginatedResult,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { isUniqueConstraintError } from '@/common/prisma-relations';
import { searchVariants } from '@/common/search-variants';
import { assertIdsInTenant } from '@/common/tenant-guards';
import { MailService } from '@/mail/mail.service';
import { trySend } from '@/mail/try-send';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

/**
 * TKT-0060: the three account states an admin needs to tell apart. Derived server-side from
 * `isActive` + whether a password has been set — `isActive` is checked first, so an account
 * that was invited and then deactivated reads INACTIVE, and the resend action (which keys off
 * PENDING) correctly disappears for it.
 */
export type UserAccountStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE';

// Response shape is unchanged from the scalar-column era: `role`/`tenantId` are
// synthesized from the user's membership (relative to the request's tenant).
export type UserSummary = Omit<User, 'passwordHash' | 'isSuperAdmin'> & {
  role: UserRole;
  tenantId: string | null;
  status: UserAccountStatus;
  locations: Array<{ id: string; name: string }>;
};

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  isSuperAdmin: true,
  // TKT-0060: read to derive `status`, never serialised — toSummary destructures it out and
  // UserSummarySchema does not declare it, so neither the type nor the wire can carry it.
  passwordHash: true,
  createdAt: true,
  updatedAt: true,
  locations: { select: { id: true, name: true } },
  memberships: {
    select: { tenantId: true, role: true },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

// Maps a DB row to the API shape. `tenantId` picks which membership provides
// role/tenantId; when omitted, the user's first membership is used (single-
// membership world until TKT-0001/0003 land).
function toSummary(row: UserRow, tenantId?: string | null): UserSummary {
  const { isSuperAdmin, memberships, passwordHash, ...rest } = row;
  const membership =
    tenantId != null
      ? memberships.find((m) => m.tenantId === tenantId)
      : memberships[0];
  return {
    ...rest,
    role: isSuperAdmin ? UserRole.SUPER_ADMIN : membership!.role,
    tenantId: isSuperAdmin ? null : (membership?.tenantId ?? null),
    status: !rest.isActive ? 'INACTIVE' : passwordHash === null ? 'PENDING' : 'ACTIVE',
  };
}

/**
 * TKT-0054: ADMIN and EMPLOYEE reads are filtered by their assigned locations
 * (`LocationScopeService`), so an account of either role without one can sign in and see
 * nothing. Refuse to create or leave that state. CUSTOMER is scoped by ownership and
 * SUPER_ADMIN is unrestricted, so neither needs an assignment.
 */
function assertLocationScopedRoleHasLocations(
  role: UserRole | undefined,
  locationIds: readonly string[] | undefined,
): void {
  if (role !== UserRole.ADMIN && role !== UserRole.EMPLOYEE) return;
  if (locationIds && locationIds.length > 0) return;
  throw new BadRequestException({
    message: `A ${role} needs at least one location`,
    code: 'USER_NEEDS_LOCATION',
    params: { role },
  });
}

export interface UserListFilters {
  role?: UserRole;
  search?: string;
}

/**
 * TKT-0078: the search clause goes into `AND`, never beside the ADMIN scope in `where.OR`.
 * `where.OR` *is* the location scope; a second top-level OR would replace it and hand an ADMIN
 * every user in the club. Nested here, the two compose: (scope) AND (matches the query).
 */
function searchClause(search: string | undefined): Prisma.UserWhereInput[] {
  const variants = searchVariants(search ?? '');
  if (variants.length === 0) return [];
  return [
    {
      OR: variants.flatMap((v) => [
        { email: { contains: v } },
        { firstName: { contains: v } },
        { lastName: { contains: v } },
      ]),
    },
  ];
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly scope: LocationScopeService,
    // The abstract token, never a concrete transport — MailModule binds console/smtp.
    private readonly mail: MailService,
  ) {}

  /**
   * Lists users in the given tenant. ADMIN sees users at their assigned locations
   * (plus themselves); SUPER_ADMIN sees all users in the tenant.
   *
   * An optional role filter narrows the membership condition itself, so it means "holds this role
   * here" and not "holds it anywhere". It never widens the result: the location scope below is an
   * AND beside it, including its self-clause, so an ADMIN asking for EMPLOYEE does not get back
   * themselves.
   */
  async list(
    actor: AuthenticatedUser,
    tenantId: string,
    pagination?: PaginationInput,
    filters?: UserListFilters,
  ): Promise<PaginatedResult<UserSummary>> {
    const where: Prisma.UserWhereInput = {
      memberships: { some: { tenantId, ...(filters?.role ? { role: filters.role } : {}) } },
    };
    const search = searchClause(filters?.search);
    if (search.length > 0) where.AND = search;
    if (actor.role === UserRole.ADMIN) {
      const allowedIds = (await this.scope.getAccessibleLocationIds(actor, tenantId)) ?? [];
      where.OR = [
        { id: actor.id },
        { locations: { some: { id: { in: allowedIds } } } },
      ];
    }
    const p = normalizePagination(pagination);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { email: 'asc' }],
        select: USER_SELECT,
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.user.count({ where }),
    ]);
    return buildPaginatedResult(rows.map((r) => toSummary(r, tenantId)), total, p);
  }

  async findById(actor: AuthenticatedUser, id: string): Promise<UserSummary> {
    const user = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    if (actor.role === UserRole.SUPER_ADMIN) return toSummary(user);

    // Tenant users may only see users who are members of their own tenant.
    if (!user.memberships.some((m) => m.tenantId === actor.tenantId)) {
      throw new NotFoundException(`User ${id} not found`);
    }
    if (actor.role === UserRole.ADMIN && user.id !== actor.id) {
      const allowedIds = (await this.scope.getAccessibleLocationIds(actor, actor.tenantId!)) ?? [];
      const hasIntersection = user.locations.some((l) => allowedIds.includes(l.id));
      if (!hasIntersection) throw new NotFoundException(`User ${id} not found`);
    }
    return toSummary(user, actor.tenantId);
  }

  async create(
    actor: AuthenticatedUser,
    tenantIdFromContext: string | null,
    dto: CreateUserDto,
  ): Promise<UserSummary & { attachedExisting?: boolean; notificationSent: boolean }> {
    // Determine the resolved tenantId for the new user based on the requested role.
    const targetTenantId = await this.resolveCreateTenantId(actor, tenantIdFromContext, dto);

    // Role-based permission checks.
    this.assertCanAssignRole(actor, dto.role);

    assertLocationScopedRoleHasLocations(dto.role, dto.locationIds);

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

    // Attach path (PRD-0001): the email may already have an account in another tenant — one
    // login across clubs. The existing hash is never touched. What gets mailed depends on
    // whether that account has a password: one it can use (an invite) or a notice that it now
    // reaches another club. See the branch below.
    if (targetTenantId !== null) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: {
          id: true,
          isActive: true,
          isSuperAdmin: true,
          memberships: { select: { tenantId: true } },
        },
      });
      if (existing) {
        if (existing.memberships.some((m) => m.tenantId === targetTenantId)) {
          // Hard 409, never a role upsert — role changes go through member-edit.
          throw new ConflictException({
            message: 'Already a member',
            code: 'USER_ALREADY_MEMBER',
          });
        }
        if (existing.isSuperAdmin) {
          // SUPER_ADMIN already has global access; a membership makes no sense.
          throw new ConflictException({
            message: 'Cannot attach a SUPER_ADMIN account',
            code: 'USER_ATTACH_SUPER_ADMIN',
          });
        }
        if (!existing.isActive) {
          // validateUser refuses a deactivated account, so the membership would be unusable and
          // the mail below would announce access the person does not have. Reactivate, then attach.
          throw new ConflictException({
            message: 'That account is deactivated; reactivate it before adding it to a club',
            code: 'USER_DEACTIVATED',
          });
        }
        try {
          const attached = await this.prisma.user.update({
            where: { id: existing.id },
            data: {
              memberships: { create: { tenantId: targetTenantId, role: dto.role } },
              locations:
                dto.locationIds && dto.locationIds.length > 0
                  ? { connect: dto.locationIds.map((id) => ({ id })) }
                  : undefined,
            },
            select: {
              ...USER_SELECT,
              // The response must not leak the account's other tenants.
              locations: {
                where: { tenantId: targetTenantId },
                select: { id: true, name: true },
              },
            },
          });
          // TKT-0061: the club name comes from the resolved target tenant, never from the
          // request, so the mail cannot be made to name a club the actor is not acting in.
          const club = await this.prisma.tenant.findUnique({
            where: { id: targetTenantId },
            select: { name: true },
          });
          // Mail sits outside the write, as on the create path: the membership is committed
          // and delivery is reported.
          //
          // TKT-0063: which mail goes out is decided by whether a password exists, not merely
          // by whether the account did. An account invited elsewhere and never accepted still
          // has none, and a club-access notice tells the reader to sign in with their usual
          // password — so it would send a passwordless person nowhere, with no link either.
          // Same rule and same precedence as tenants.service.ts. The raw hash rather than
          // UserSummary.status: status folds in isActive, and an inactive-and-passwordless
          // account would then read INACTIVE and take the wrong arm.
          const notificationSent =
            attached.passwordHash === null
              ? await this.auth.issueInvite(attached)
              : await trySend(
                  this.logger,
                  `Failed to send club-access email (userId=${attached.id})`,
                  () =>
                    this.mail.sendClubAccess({
                      to: attached.email,
                      clubName: club!.name,
                      role: dto.role,
                    }),
                );
          return {
            ...toSummary(attached, targetTenantId),
            attachedExisting: true,
            notificationSent,
          };
        } catch (e) {
          // Concurrent attach — the membership unique constraint wins the race.
          if (isUniqueConstraintError(e)) {
            throw new ConflictException({
              message: 'Already a member',
              code: 'USER_ALREADY_MEMBER',
            });
          }
          throw e;
        }
      }
    }

    try {
      const created = await this.prisma.user.create({
        data: {
          email: dto.email,
          // TKT-0058: null until the invite is accepted. validateUser rejects a falsy hash,
          // so a pending account cannot sign in.
          passwordHash: null,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          phone: dto.phone ?? null,
          isSuperAdmin: dto.role === UserRole.SUPER_ADMIN,
          memberships:
            targetTenantId !== null
              ? { create: { tenantId: targetTenantId, role: dto.role } }
              : undefined,
          locations:
            dto.locationIds && dto.locationIds.length > 0
              ? { connect: dto.locationIds.map((id) => ({ id })) }
              : undefined,
        },
        select: USER_SELECT,
      });
      // Mail sits outside the create transaction on purpose (PRD-0010 §7): the account
      // commits first, and delivery is reported rather than transacted.
      const notificationSent = await this.auth.issueInvite(created);
      return { ...toSummary(created, targetTenantId), notificationSent };
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: `Email "${dto.email}" already exists`,
          code: 'USER_EMAIL_TAKEN',
          params: { email: dto.email },
        });
      }
      throw e;
    }
  }

  /**
   * TKT-0060: re-issues the invite for an account that has not accepted yet.
   *
   * `findById` is the authorisation — it applies the tenant-membership check and, for an ADMIN,
   * the location intersection, answering 404 (not 403) for a target outside their scope, the
   * same non-disclosing answer every other per-target route gives.
   *
   * The 409 is the rule that stops this being a general-purpose password-reset trigger an admin
   * could aim at a colleague: only a PENDING account gets a new link. An account that has
   * accepted, or one that has been deactivated, is refused — in the second case the link could
   * not be used anyway, since validateUser rejects an inactive account.
   */
  async resendInvite(
    actor: AuthenticatedUser,
    id: string,
  ): Promise<{ inviteEmailSent: boolean }> {
    const target = await this.findById(actor, id);
    if (target.status !== 'PENDING') {
      throw new ConflictException({
        message: 'Only a pending invite can be re-sent',
        code: 'USER_INVITE_NOT_PENDING',
      });
    }
    // issueInvite invalidates every prior unused token and creates one fresh, in one
    // transaction, then mails once and reports delivery rather than throwing.
    return { inviteEmailSent: await this.auth.issueInvite(target) };
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateUserDto,
  ): Promise<UserSummary> {
    const target = await this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
    if (!target) throw new NotFoundException(`User ${id} not found`);

    // Visibility check uses findById's logic (tenant + admin-scope).
    await this.findById(actor, id);

    const isSelf = actor.id === id;
    const isActorSuper = actor.role === UserRole.SUPER_ADMIN;

    // Role changes are SUPER_ADMIN-only.
    if (dto.role !== undefined && !isActorSuper) {
      throw new ForbiddenException('Only SUPER_ADMIN can change a user role');
    }
    // ADMIN cannot edit SUPER_ADMIN users.
    if (target.isSuperAdmin && actor.role === UserRole.ADMIN) {
      throw new ForbiddenException('ADMIN cannot modify SUPER_ADMIN users');
    }

    // Role lives on the membership now; SUPER_ADMIN status is account-level and immutable here.
    const targetTenantId = target.memberships[0]?.tenantId ?? null;
    if (dto.role !== undefined) {
      if (target.isSuperAdmin || dto.role === UserRole.SUPER_ADMIN) {
        throw new BadRequestException('Cannot change SUPER_ADMIN status via role update');
      }
    }

    // Location reassignment rules.
    if (dto.locationIds !== undefined) {
      if (targetTenantId === null) {
        throw new BadRequestException('SUPER_ADMIN users cannot have locations');
      }
      await this.assertLocationsInTenant(targetTenantId, dto.locationIds);
      if (actor.role === UserRole.ADMIN) {
        await this.scope.assertLocationsAllowed(actor, targetTenantId, dto.locationIds);
      }
    }

    // The resulting role and location set, whichever of the two the caller is changing.
    assertLocationScopedRoleHasLocations(
      dto.role ?? target.memberships[0]?.role,
      dto.locationIds ?? target.locations.map((l) => l.id),
    );

    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName ?? null;
    if (dto.lastName !== undefined) data.lastName = dto.lastName ?? null;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.isActive !== undefined) {
      // Self-deactivation guard: SUPER_ADMIN cannot lock themselves out.
      if (isSelf && dto.isActive === false && isActorSuper) {
        throw new ForbiddenException('SUPER_ADMIN cannot deactivate themselves');
      }
      data.isActive = dto.isActive;
    }
    if (dto.password !== undefined) data.passwordHash = await this.auth.hashPassword(dto.password);
    if (dto.role !== undefined && targetTenantId !== null) {
      data.memberships = {
        update: {
          where: { userId_tenantId: { userId: id, tenantId: targetTenantId } },
          data: { role: dto.role },
        },
      };
    }
    if (dto.locationIds !== undefined) {
      data.locations = { set: dto.locationIds.map((lid) => ({ id: lid })) };
    }

    // A new password or a deactivation has to end the sessions already running, or the person
    // it was aimed at keeps refreshing for JWT_REFRESH_TTL. Lazy: a PrismaPromise does not run
    // until awaited, so the same expression serves both branches and the revocation lands in
    // one transaction with the update.
    const update = this.prisma.user.update({ where: { id }, data, select: USER_SELECT });
    const endsSessions = dto.password !== undefined || dto.isActive === false;

    try {
      const updated = endsSessions
        ? (await this.prisma.$transaction([update, this.auth.revokeAllRefreshTokens(id)]))[0]
        : await update;
      return toSummary(updated, targetTenantId);
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        throw new ConflictException({
          message: 'Email already exists',
          code: 'USER_EMAIL_TAKEN',
        });
      }
      throw e;
    }
  }

  async delete(actor: AuthenticatedUser, id: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, isSuperAdmin: true, memberships: { select: { tenantId: true } } },
    });
    if (!target) throw new NotFoundException(`User ${id} not found`);

    if (actor.id === id) {
      throw new ForbiddenException('You cannot delete yourself');
    }

    if (actor.role === UserRole.ADMIN) {
      if (target.isSuperAdmin) {
        throw new ForbiddenException('ADMIN cannot delete SUPER_ADMIN users');
      }
      if (!target.memberships.some((m) => m.tenantId === actor.tenantId)) {
        throw new NotFoundException(`User ${id} not found`);
      }
      // ADMIN scope check via the regular visibility helper.
      await this.findById(actor, id);

      // Per-membership removal (PRD-0001): sever only this tenant's ties — the
      // membership plus this tenant's location links (otherwise a later re-attach
      // would inherit stale location grants). Account, password, and other-tenant
      // memberships stay intact.
      const tenantLocations = await this.prisma.location.findMany({
        where: { tenantId: actor.tenantId!, trainers: { some: { id } } },
        select: { id: true },
      });
      await this.prisma.user.update({
        where: { id },
        data: {
          memberships: {
            delete: { userId_tenantId: { userId: id, tenantId: actor.tenantId! } },
          },
          locations: tenantLocations.length
            ? { disconnect: tenantLocations.map((l) => ({ id: l.id })) }
            : undefined,
        },
      });
      return;
    }

    // SUPER_ADMIN: full account deletion (global operator) — unchanged.
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

  private assertLocationsInTenant(tenantId: string, ids: readonly string[]): Promise<void> {
    return assertIdsInTenant(
      ids,
      (x) => this.prisma.location.count({ where: { id: { in: x }, tenantId } }),
      'Some locationIds are invalid or not in the tenant',
    );
  }
}
