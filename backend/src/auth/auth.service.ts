import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { UserRole, type Membership, type Prisma, type User } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  type AccessJwtPayload,
  type TokenPair,
} from './types/jwt-payload';

// Memberships pre-filtered to active tenants, oldest first (see activeMemberships()).
type LoadedMembership = Membership & { tenant: { name: string } };
type UserWithMemberships = User & { memberships?: LoadedMembership[] };

// Shape of the memberships array in the login response.
export interface LoginMembership {
  tenantId: string;
  tenantName: string;
  role: UserRole;
}

const BCRYPT_ROUNDS = 10;
const DEFAULT_RESET_TTL_HOURS = 1;
const DEFAULT_INVITE_TTL_HOURS = 48;
// How long after a rotation a superseded refresh token is still treated as a
// benign race rather than a replay. Long enough to cover a tab losing the race or
// a dropped response, short enough that a stolen token is near-useless.
const REFRESH_GRACE_MS = 10_000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  async validateUser(email: string, password: string): Promise<UserWithMemberships | null> {
    // Email is globally unique, so it identifies exactly one account; tenant access
    // comes from Membership rows. Tenant users need at least one membership in an
    // active tenant; SUPER_ADMIN has no memberships.
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: activeMemberships() },
    });
    // TKT-0058: an invited account has no password until it accepts. Falsy covers both null
    // and '' — bcrypt.compare throws on either, which would answer 500 where an unknown email
    // answers 401. Returning null here keeps the two indistinguishable.
    if (!user || !user.isActive || !user.passwordHash) return null;
    const ok = await this.verifyPassword(password, user.passwordHash);
    return ok ? user : null;
  }

  // Accepts memberships with or without the tenant join — login only needs role/tenantId.
  async login(user: User & { memberships?: Membership[] }): Promise<TokenPair> {
    const pair = await this.issueTokens(user, undefined, this.prisma);
    await this.purgeExpiredTokens(user.id);
    return pair;
  }

  // Lazy purge: dead rows only accumulate on the paths that also clean them, so
  // no scheduler — and no multi-instance coordination — is needed.
  //
  // Keyed on expiresAt ALONE, never revokedAt. A revoked-but-unexpired row is
  // the replay tripwire reuse detection depends on: deleting it would turn a
  // detected reuse into an indistinguishable "row not found" and silently
  // disable family revocation. Dead rows therefore age out over
  // JWT_REFRESH_TTL rather than vanishing at rotation. Still bounded.
  private async purgeExpiredTokens(userId: string): Promise<void> {
    const now = new Date();
    try {
      await this.prisma.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: now } } });
      await this.prisma.passwordResetToken.deleteMany({
        where: { userId, expiresAt: { lt: now } },
      });
    } catch (err) {
      // Housekeeping must never fail the sign-in it rides on.
      this.logger.warn(`Token purge failed (userId=${userId})`, err as Error);
    }
  }

  // Mints an access + refresh pair. `familyId` undefined starts a new family (the
  // schema default fires); rotation passes the parent's value so the lineage
  // continues. `client` lets rotation create the row inside its transaction.
  private async issueTokens(
    user: User & { memberships?: Membership[] },
    familyId: string | undefined,
    client: Prisma.TransactionClient,
  ): Promise<TokenPair> {
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    const accessSecret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!accessSecret) throw new Error('JWT_ACCESS_SECRET is not set');

    // Claims come from the membership now, not from scalar columns. In the current
    // single-membership world the first (oldest) active-tenant membership is the
    // user's only one.
    // ponytail: first-membership fallback for multi-membership accounts — replaced
    // by the login picker contract in TKT-0001; nothing can create a second
    // membership until TKT-0003.
    const memberships =
      user.memberships ??
      (await client.membership.findMany({
        where: { userId: user.id, ...activeMemberships().where },
        orderBy: activeMemberships().orderBy,
      }));
    const active = memberships[0];
    if (!user.isSuperAdmin && !active) {
      throw new ForbiddenException('No active memberships');
    }

    const payload: AccessJwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.isSuperAdmin ? UserRole.SUPER_ADMIN : active!.role,
      tenantId: user.isSuperAdmin ? null : active!.tenantId,
      type: 'access',
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: accessSecret,
      expiresIn: accessTtl as JwtSignOptions['expiresIn'],
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    const refreshToken = randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(refreshToken);
    const refreshExpiresIn = parseDurationSeconds(refreshTtl);

    await client.refreshToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshExpiresIn * 1000),
        ...(familyId ? { familyId } : {}),
      },
    });

    return { accessToken, refreshToken };
  }

  // Fresh membership list for the memberships endpoint — same shape and ordering
  // as the login response. SUPER_ADMIN has no memberships → [].
  async listMemberships(userId: string): Promise<LoginMembership[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, ...activeMemberships().where },
      orderBy: activeMemberships().orderBy,
      include: activeMemberships().include,
    });
    return memberships.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      role: m.role,
    }));
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const tokenHash = sha256Hex(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { memberships: activeMemberships() } } },
    });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');
    // Expiry and deactivation are absolute — checked before the revoked branch so
    // neither can be reached through the grace path below.
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (!stored.user.isActive) throw new UnauthorizedException('User inactive');

    if (stored.revokedAt) {
      // Two tabs racing, or a rotation whose response never reached the client,
      // look exactly like a replay. Treat it as the same session retrying when the
      // rotation was recent AND its successor is still live, and issue a fresh
      // pair without touching the already-revoked row (re-stamping revokedAt would
      // slide the window forward and make one token reusable indefinitely).
      if (await this.hasLiveSuccessor(stored)) {
        // Revoke the successor too, so the family keeps exactly one live chain.
        // Leaving it live forks the family: both chains then rotate cleanly and
        // never present a revoked row again, which puts reuse detection below
        // permanently out of reach and lets a thief persist past remediation.
        await this.prisma.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        this.logger.warn(
          `Refresh grace applied (userId=${stored.userId}, familyId=${stored.familyId})`,
        );
        return this.issueTokens(stored.user, stored.familyId, this.prisma);
      }
      // Reuse detected: someone presented a token that was already rotated away.
      // End the whole grant — every live token descended from that login — so a
      // thief who lost the race keeps nothing. RFC 9700 4.14.2. Scoped to the
      // family, never the user: other devices stay signed in.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(
        `Refresh token replay detected (userId=${stored.userId}, familyId=${stored.familyId})`,
      );
      throw new UnauthorizedException('Refresh token revoked');
    }

    // Revoke-then-issue must be atomic, or a crash between them strands the user
    // with a revoked token and no replacement.
    const pair = await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      return this.issueTokens(stored.user, stored.familyId, tx);
    });

    // Outside the transaction on purpose: inside it, a purge failure would roll
    // back the rotation, and a purge on the non-transactional client would block
    // on the writer lock this transaction still holds.
    await this.purgeExpiredTokens(stored.userId);
    return pair;
  }

  // A revoked token gets the benefit of the doubt only while its rotation is
  // recent AND the family still holds a live token. Rotation creates that
  // successor; logout and password reset revoke without creating one — which is
  // what keeps them taking effect immediately instead of lingering for the
  // window. Time alone would not distinguish the two.
  private async hasLiveSuccessor(stored: { familyId: string; revokedAt: Date | null }): Promise<boolean> {
    if (!stored.revokedAt) return false;
    if (Date.now() - stored.revokedAt.getTime() > REFRESH_GRACE_MS) return false;
    const live = await this.prisma.refreshToken.count({
      where: { familyId: stored.familyId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return live > 0;
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = sha256Hex(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }


  /**
   * TKT-0058: mints an invite for an account that has no password yet and mails the link.
   *
   * Deliberately a PasswordResetToken rather than a new model (PRD-0010 §7): the columns fit,
   * `completePasswordReset` already consumes them, and `purgeExpiredTokens` already sweeps the
   * table — so the invite inherits single-use, expiry-on-consume and bounded growth for free.
   *
   * Lives here rather than in UsersService because every ingredient already does: sha256Hex,
   * randomBytes, the invalidate-then-create transaction, FRONTEND_URL, and the only
   * MailService injection.
   *
   * Returns whether the mail went out. The caller reports that to the admin as
   * `inviteEmailSent`; it never throws, because the account is already committed and a failed
   * send is recoverable by re-sending rather than by losing the account.
   */
  async issueInvite(user: { id: string; email: string }): Promise<boolean> {
    const ttlHours = Number(
      this.config.get<string>('INVITE_TTL_HOURS') ?? DEFAULT_INVITE_TTL_HOURS,
    );
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(rawToken);

    // Any earlier unused token is invalidated in the same transaction, so a re-issue cannot
    // leave two live links for one account.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      }),
    ]);

    const frontendUrl = (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    const inviteUrl = `${frontendUrl}/accept-invite/${rawToken}`;

    try {
      await this.mail.sendInvite({ to: user.email, inviteUrl, expiresAt });
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send invite email (userId=${user.id})`,
        err as Error,
      );
      return false;
    }
  }
  async requestPasswordReset(email: string): Promise<void> {
    // Email is globally unique, so it maps to at most one account.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return;

    const ttlHours = Number(this.config.get<string>('PASSWORD_RESET_TTL_HOURS') ?? DEFAULT_RESET_TTL_HOURS);
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(rawToken);

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      }),
    ]);

    const frontendUrl = (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    const resetUrl = `${frontendUrl}/reset-password/${rawToken}`;

    try {
      await this.mail.sendPasswordReset({ to: user.email, resetUrl, expiresAt });
    } catch (err) {
      // Never bubble mail errors to the anonymous caller — logging is enough.
      this.logger.error(`Failed to send password-reset email (userId=${user.id})`, err as Error);
    }
  }

  async completePasswordReset(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = sha256Hex(rawToken);
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    const invalid = (): never => {
      throw new BadRequestException({
        message: 'Invalid or expired reset link',
        code: 'AUTH_RESET_LINK_INVALID',
      });
    };

    if (!stored) invalid();
    if (stored!.usedAt) invalid();
    if (stored!.expiresAt.getTime() < Date.now()) invalid();
    if (!stored!.user.isActive) invalid();

    const passwordHash = await this.hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored!.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: stored!.id },
        data: { usedAt: new Date() },
      }),
      this.revokeAllRefreshTokens(stored!.userId),
    ]);
  }

  /**
   * Ends every live session of a user by revoking their unrevoked refresh tokens.
   *
   * Returned un-awaited on purpose: a PrismaPromise does not run until it is awaited or handed
   * to `$transaction`, so both callers can make the revocation atomic with the write that
   * caused it — the self-service reset above, and an admin setting a password or deactivating
   * an account (users.service.ts). Access tokens already issued still stand until they expire;
   * that 15-minute window is the accepted stateless trade-off recorded in PRD-0006.
   */
  revokeAllRefreshTokens(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

// Shared shape for loading a user's memberships: active tenants only, oldest first,
// tenant name included (surfaces in the login response's memberships array).
function activeMemberships() {
  return {
    where: { tenant: { isActive: true } },
    orderBy: { createdAt: 'asc' as const },
    include: { tenant: { select: { name: true } } },
  };
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Accepts e.g. '30s', '15m', '2h', '7d'. Returns seconds.
// Exported so the controller can give the refresh cookie the same lifetime as the row.
export function parseDurationSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(ttl);
  if (!match) throw new Error(`Invalid duration: ${ttl}`);
  const n = parseInt(match[1] as string, 10);
  const unit = (match[2] as string).toLowerCase();
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  // eslint-disable-next-line security/detect-object-injection -- `unit` is regex-bounded to [smhd]
  return n * (mult[unit] ?? 0);
}
