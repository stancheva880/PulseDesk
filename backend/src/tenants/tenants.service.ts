import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from '@/auth/auth.service';
import { isUniqueConstraintError } from '@/common/prisma-relations';
import { MailService } from '@/mail/mail.service';
import { trySend } from '@/mail/try-send';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { CreatedTenant, TenantSummary } from './tenants.controller';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    // The abstract token, never a concrete transport — MailModule binds console/smtp.
    private readonly mail: MailService,
  ) {}

  /**
   * Onboards a club: the tenant, its first location, and its first ADMIN with a membership and
   * that location assigned — all in one transaction, so a failure at any step leaves nothing
   * behind. An email that already exists gains a membership instead of a second account (one
   * login across clubs, PRD-0001).
   *
   * TKT-0062: no password is chosen here. The administrator is mailed after the transaction
   * commits — an invite if they have no password yet, a club-access notice if they already do.
   * Mail is deliberately outside the transaction (PRD-0010 §7): an SMTP round trip inside a
   * database lock is worse than an unnotified administrator, whose invite can be re-sent.
   */
  async create(dto: CreateTenantDto): Promise<CreatedTenant> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.adminEmail },
      select: { id: true, isActive: true, isSuperAdmin: true, passwordHash: true },
    });
    if (existing?.isSuperAdmin) {
      // A SUPER_ADMIN already reaches every club; a membership would mean nothing.
      throw new ConflictException({
        message: 'Cannot make a SUPER_ADMIN account a club administrator',
        code: 'TENANT_ADMIN_IS_SUPER_ADMIN',
      });
    }
    if (existing && !existing.isActive) {
      // Same rule as the attach path on POST /users: a deactivated account cannot sign in, so
      // this club would launch with nobody able to administer it.
      throw new ConflictException({
        message: 'That account is deactivated; reactivate it before making it a club administrator',
        code: 'TENANT_ADMIN_DEACTIVATED',
      });
    }

    let tenant: TenantSummary;
    let adminId: string;
    try {
      ({ tenant, adminId } = await this.prisma.$transaction(async (tx) => {
        const created = await tx.tenant.create({
          data: { name: dto.name, slug: dto.slug },
          select: { id: true, slug: true, name: true, isActive: true },
        });
        const location = await tx.location.create({
          data: {
            tenantId: created.id,
            name: dto.locationName,
            address: dto.locationAddress ?? null,
          },
          select: { id: true },
        });
        const membership = { create: { tenantId: created.id, role: UserRole.ADMIN } };
        const assignment = { connect: [{ id: location.id }] };

        if (existing) {
          await tx.user.update({
            where: { id: existing.id },
            data: { memberships: membership, locations: assignment },
            select: { id: true },
          });
          return { tenant: created, adminId: existing.id };
        }
        const admin = await tx.user.create({
          data: {
            email: dto.adminEmail,
            // TKT-0062: null until the invite is accepted, as on POST /users.
            passwordHash: null,
            firstName: dto.adminFirstName ?? null,
            lastName: dto.adminLastName ?? null,
            memberships: membership,
            locations: assignment,
          },
          select: { id: true },
        });
        return { tenant: created, adminId: admin.id };
      }));
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        // Either the slug or the email raced us; the slug is the one a caller can act on.
        throw new ConflictException({
          message: `A club with slug "${dto.slug}" already exists`,
          code: 'TENANT_SLUG_TAKEN',
          params: { slug: dto.slug },
        });
      }
      throw e;
    }

    // Which mail goes out is decided by whether a password exists, not merely by whether the
    // account did: an account that was invited elsewhere and never accepted still has none, so
    // telling it to "sign in as usual" would leave that person with no way in at all.
    // Reported, not transacted: the club and its administrator are committed either way, and a
    // failed send is recovered by the resend action on the pending Users row. What the caller
    // needs is to be told, which CreatedTenant.notificationSent now carries.
    let notificationSent: boolean;
    if (existing?.passwordHash != null) {
      notificationSent = await trySend(
        this.logger,
        `Failed to send club-access email (userId=${adminId})`,
        () =>
          this.mail.sendClubAccess({
            // The persisted club name, never dto.name, so the mail cannot name another club.
            to: dto.adminEmail,
            clubName: tenant.name,
            role: UserRole.ADMIN,
          }),
      );
    } else {
      // issueInvite reports delivery rather than throwing, so the log line is for the operator
      // and the boolean is for the caller.
      notificationSent = await this.auth.issueInvite({ id: adminId, email: dto.adminEmail });
      if (!notificationSent) {
        this.logger.error(`Failed to send onboarding invite (userId=${adminId})`);
      }
    }

    return { ...tenant, notificationSent };
  }
}
