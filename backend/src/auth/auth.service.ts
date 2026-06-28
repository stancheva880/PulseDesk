import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { type User } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { MailService } from '@/mail/mail.service';
import type { AccessJwtPayload, AuthenticatedUser, TokenPair } from './types/jwt-payload';

const BCRYPT_ROUNDS = 10;
const DEFAULT_RESET_TTL_HOURS = 1;

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

  async validateUser(email: string, password: string): Promise<User | null> {
    // Email is globally unique, so it identifies exactly one account; the tenant
    // (if any) comes from the user record. Tenant users must belong to an active tenant.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return null;
    if (user.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
      if (!tenant || !tenant.isActive) return null;
    }
    const ok = await this.verifyPassword(password, user.passwordHash);
    return ok ? user : null;
  }

  async login(user: User): Promise<TokenPair> {
    const accessTtl = this.config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    const accessSecret = this.config.get<string>('JWT_ACCESS_SECRET');
    if (!accessSecret) throw new Error('JWT_ACCESS_SECRET is not set');

    const payload: AccessJwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      type: 'access',
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: accessSecret,
      expiresIn: accessTtl as JwtSignOptions['expiresIn'],
    });

    const refreshToken = randomBytes(32).toString('base64url');
    const tokenHash = sha256Hex(refreshToken);
    const refreshExpiresIn = parseDurationSeconds(refreshTtl);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshExpiresIn * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      accessExpiresIn: parseDurationSeconds(accessTtl),
      refreshExpiresIn,
    };
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const tokenHash = sha256Hex(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');
    if (stored.revokedAt) throw new UnauthorizedException('Refresh token revoked');
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (!stored.user.isActive) throw new UnauthorizedException('User inactive');

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.login(stored.user);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = sha256Hex(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };
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
      throw new BadRequestException('Invalid or expired reset link');
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
      this.prisma.refreshToken.updateMany({
        where: { userId: stored!.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// Accepts e.g. '30s', '15m', '2h', '7d'. Returns seconds.
export function parseDurationSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(ttl);
  if (!match) throw new Error(`Invalid duration: ${ttl}`);
  const n = parseInt(match[1] as string, 10);
  const unit = (match[2] as string).toLowerCase();
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (mult[unit] ?? 0);
}
