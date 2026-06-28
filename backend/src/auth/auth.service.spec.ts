import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import type { AccessJwtPayload } from './types/jwt-payload';

const TEST_PASSWORD = 'TestPass123!';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwt: JwtService;
  const mailMock = {
    send: vi.fn(),
    sendInvite: vi.fn(),
    sendPasswordReset: vi.fn(),
  };
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        JwtModule.register({}),
      ],
      providers: [
        AuthService,
        PrismaService,
        { provide: MailService, useValue: mailMock },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
    prisma = moduleRef.get(PrismaService);
    jwt = moduleRef.get(JwtService);
    await prisma.onModuleInit();
  });

  beforeEach(() => {
    mailMock.send.mockReset();
    mailMock.sendInvite.mockReset();
    mailMock.sendPasswordReset.mockReset();
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdTenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
    }
    await prisma.onModuleDestroy();
  });

  async function createTenantUser(role: UserRole = UserRole.EMPLOYEE) {
    const slug = `t-${randomUUID()}`;
    const tenant = await prisma.tenant.create({ data: { name: 'Test Tenant', slug } });
    createdTenantIds.push(tenant.id);
    const email = `${randomUUID()}@test.local`;
    const passwordHash = await service.hashPassword(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, role, tenantId: tenant.id },
    });
    createdUserIds.push(user.id);
    return { user, tenant, email };
  }

  async function createSuperAdmin() {
    const email = `${randomUUID()}@superadmin.local`;
    const passwordHash = await service.hashPassword(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { email, passwordHash, role: UserRole.SUPER_ADMIN, tenantId: null },
    });
    createdUserIds.push(user.id);
    return { user, email };
  }

  describe('hashPassword / verifyPassword', () => {
    it('hashes and verifies a password (round trip)', async () => {
      const hash = await service.hashPassword('hello-world');
      expect(hash).not.toBe('hello-world');
      expect(hash.length).toBeGreaterThan(20);
      expect(await service.verifyPassword('hello-world', hash)).toBe(true);
      expect(await service.verifyPassword('wrong', hash)).toBe(false);
    });
  });

  describe('validateUser', () => {
    it('returns the user when email + password match', async () => {
      const { user, email } = await createTenantUser();
      const result = await service.validateUser(email, TEST_PASSWORD);
      expect(result?.id).toBe(user.id);
    });

    it('returns null on wrong password', async () => {
      const { email } = await createTenantUser();
      const result = await service.validateUser(email, 'wrong');
      expect(result).toBeNull();
    });

    it('returns null for an unknown email', async () => {
      const result = await service.validateUser('nobody@nowhere.local', TEST_PASSWORD);
      expect(result).toBeNull();
    });

    it('returns null for inactive users', async () => {
      const { user, email } = await createTenantUser();
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      const result = await service.validateUser(email, TEST_PASSWORD);
      expect(result).toBeNull();
    });

    it("returns null when the user's tenant is inactive", async () => {
      const { tenant, email } = await createTenantUser();
      await prisma.tenant.update({ where: { id: tenant.id }, data: { isActive: false } });
      const result = await service.validateUser(email, TEST_PASSWORD);
      expect(result).toBeNull();
    });

    it('returns the super admin by email (tenantId null)', async () => {
      const { user, email } = await createSuperAdmin();
      const result = await service.validateUser(email, TEST_PASSWORD);
      expect(result?.id).toBe(user.id);
      expect(result?.tenantId).toBeNull();
    });
  });

  describe('login', () => {
    it('issues an access + refresh pair and persists a refresh-token row', async () => {
      const { user } = await createTenantUser(UserRole.ADMIN);
      const before = await prisma.refreshToken.count({ where: { userId: user.id } });
      const tokens = await service.login(user);
      const after = await prisma.refreshToken.count({ where: { userId: user.id } });

      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
      expect(tokens.accessExpiresIn).toBeGreaterThan(0);
      expect(tokens.refreshExpiresIn).toBeGreaterThan(tokens.accessExpiresIn);
      expect(after).toBe(before + 1);
    });

    it('encodes the user identity, role, and tenantId in the access JWT', async () => {
      const { user } = await createTenantUser(UserRole.ADMIN);
      const { accessToken } = await service.login(user);
      const decoded = jwt.decode(accessToken) as AccessJwtPayload;
      expect(decoded.sub).toBe(user.id);
      expect(decoded.email).toBe(user.email);
      expect(decoded.role).toBe(UserRole.ADMIN);
      expect(decoded.tenantId).toBe(user.tenantId);
      expect(decoded.type).toBe('access');
    });

    it('encodes tenantId=null for super admins', async () => {
      const { user } = await createSuperAdmin();
      const { accessToken } = await service.login(user);
      const decoded = jwt.decode(accessToken) as AccessJwtPayload;
      expect(decoded.tenantId).toBeNull();
      expect(decoded.role).toBe(UserRole.SUPER_ADMIN);
    });
  });

  describe('refresh', () => {
    it('rotates the refresh token: returns a new pair and revokes the old one', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      const rotated = await service.refresh(initial.refreshToken);

      expect(rotated.accessToken).toBeTruthy();
      expect(rotated.refreshToken).toBeTruthy();
      expect(rotated.refreshToken).not.toBe(initial.refreshToken);

      // Old token should now be unusable
      await expect(service.refresh(initial.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an unknown refresh token', async () => {
      await expect(service.refresh('this-is-not-a-real-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revokes the given refresh token so it can no longer be used', async () => {
      const { user } = await createTenantUser();
      const tokens = await service.login(user);
      await service.logout(tokens.refreshToken);
      await expect(service.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('is a no-op for an unknown token (does not throw)', async () => {
      await expect(service.logout('not-a-real-token')).resolves.toBeUndefined();
    });
  });

  describe('requestPasswordReset', () => {
    it('persists a hashed token row and emails the user when the email matches', async () => {
      const { user, email } = await createTenantUser();

      await service.requestPasswordReset(email);

      const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.usedAt).toBeNull();
      expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());

      expect(mailMock.sendPasswordReset).toHaveBeenCalledOnce();
      const arg = mailMock.sendPasswordReset.mock.calls[0]?.[0] as {
        to: string;
        resetUrl: string;
        expiresAt: Date;
      };
      expect(arg.to).toBe(email);
      const tokenInUrl = arg.resetUrl.split('/').pop() ?? '';
      expect(tokenInUrl.length).toBeGreaterThan(20);
      // Stored hash matches sha256 of the raw token in the URL.
      const expectedHash = createHash('sha256').update(tokenInUrl).digest('hex');
      expect(rows[0]?.tokenHash).toBe(expectedHash);
    });

    it('does nothing and does not throw when the email is unknown', async () => {
      await service.requestPasswordReset('nobody@nowhere.local');
      expect(mailMock.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('silently skips inactive users (does not email)', async () => {
      const { user, email } = await createTenantUser();
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

      await service.requestPasswordReset(email);

      const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
      expect(rows).toHaveLength(0);
      expect(mailMock.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('marks any prior unused tokens as used before issuing a new one', async () => {
      const { user, email } = await createTenantUser();
      await service.requestPasswordReset(email);
      await service.requestPasswordReset(email);

      const rows = await prisma.passwordResetToken.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]?.usedAt).not.toBeNull(); // prior token invalidated
      expect(rows[1]?.usedAt).toBeNull(); // newest token still active
    });

    it('finds super-admin users by email globally (no tenant filter)', async () => {
      const { email } = await createSuperAdmin();
      await service.requestPasswordReset(email);
      expect(mailMock.sendPasswordReset).toHaveBeenCalledOnce();
    });
  });

  describe('completePasswordReset', () => {
    async function issueResetToken(): Promise<{ user: { id: string }; rawToken: string; email: string }> {
      const { user, email } = await createTenantUser();
      await service.requestPasswordReset(email);
      const arg = mailMock.sendPasswordReset.mock.calls.at(-1)?.[0] as { resetUrl: string };
      const rawToken = arg.resetUrl.split('/').pop() as string;
      return { user, rawToken, email };
    }

    it('updates the password, marks the token used, and revokes all refresh tokens', async () => {
      const { user, rawToken, email } = await issueResetToken();
      // Issue a refresh token — must end up revoked after reset.
      const before = await service.login(user as never);
      const beforeRow = await prisma.refreshToken.findFirst({
        where: { tokenHash: createHash('sha256').update(before.refreshToken).digest('hex') },
      });
      expect(beforeRow?.revokedAt).toBeNull();

      await service.completePasswordReset(rawToken, 'BrandNewPassw0rd!');

      // Password actually changed — reauth with the new password now succeeds (email-only login).
      const reauthed = await service.validateUser(email, 'BrandNewPassw0rd!');
      expect(reauthed?.id).toBe(user.id);

      // Token marked used.
      const tokenRow = await prisma.passwordResetToken.findFirst({
        where: { userId: user.id, usedAt: { not: null } },
      });
      expect(tokenRow).not.toBeNull();

      // Refresh token revoked.
      const afterRow = await prisma.refreshToken.findFirst({
        where: { tokenHash: createHash('sha256').update(before.refreshToken).digest('hex') },
      });
      expect(afterRow?.revokedAt).not.toBeNull();
    });

    it('rejects an already-used token', async () => {
      const { rawToken } = await issueResetToken();
      await service.completePasswordReset(rawToken, 'BrandNewPassw0rd!');
      await expect(
        service.completePasswordReset(rawToken, 'AnotherPassw0rd!'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an expired token', async () => {
      const { user, rawToken } = await issueResetToken();
      // Force-expire the row.
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      await expect(
        service.completePasswordReset(rawToken, 'BrandNewPassw0rd!'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unknown token', async () => {
      await expect(
        service.completePasswordReset('not-a-real-reset-token', 'BrandNewPassw0rd!'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the user has been deactivated since the token was issued', async () => {
      const { user, rawToken } = await issueResetToken();
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await expect(
        service.completePasswordReset(rawToken, 'BrandNewPassw0rd!'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
