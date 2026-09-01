import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { createTestUser } from '../test-utils/create-user';
import { AuthService } from './auth.service';
import type { AccessJwtPayload } from './types/jwt-payload';

const TEST_PASSWORD = 'TestPass123!';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;
  let jwt: JwtService;
  const mailMock = {
    send: vi.fn(),
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
    const user = await createTestUser(prisma, { email, passwordHash, role, tenantId: tenant.id });
    createdUserIds.push(user.id);
    return { user, tenant, email };
  }

  function hashOf(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  function rowFor(rawToken: string) {
    return prisma.refreshToken.findUnique({ where: { tokenHash: hashOf(rawToken) } });
  }

  // TKT-0031: a rotation less than REFRESH_GRACE_MS old with a live successor is a
  // benign race, not a replay. Tests that mean "genuine replay" must place the
  // revocation outside that window.
  async function ageOutRevocation(rawToken: string): Promise<void> {
    await prisma.refreshToken.update({
      where: { tokenHash: hashOf(rawToken) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
  }

  async function createSuperAdmin() {
    const email = `${randomUUID()}@superadmin.local`;
    const passwordHash = await service.hashPassword(TEST_PASSWORD);
    const user = await createTestUser(prisma, {
      email,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
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

    // TKT-0058: an invited account has no password yet. bcrypt 6 throws
    // "data and hash arguments required" on a null hash, which would answer 500 where an
    // unknown email answers 401 — a distinguishable oracle. The guard sits upstream of
    // verifyPassword so the pending case is byte-identical to the unknown-email case.
    it('a pending account cannot sign in and is indistinguishable from an unknown email', async () => {
      const tenant = await prisma.tenant.create({
        data: { name: 'Pending Tenant', slug: `t-${randomUUID()}` },
      });
      createdTenantIds.push(tenant.id);
      const email = `${randomUUID()}@pending.local`;
      const pending = await createTestUser(prisma, {
        email,
        passwordHash: null,
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
      });
      createdUserIds.push(pending.id);

      const pendingResult = await service.validateUser(email, TEST_PASSWORD);
      const unknownResult = await service.validateUser('nobody-at-all@nowhere.local', TEST_PASSWORD);

      expect(pendingResult).toBeNull();
      // Same return, not merely both falsy — the caller maps null to one generic 401.
      expect(pendingResult).toStrictEqual(unknownResult);
      // The account is active and present; only the missing password stops it.
      const row = await prisma.user.findUnique({ where: { email } });
      expect(row?.isActive).toBe(true);
      expect(row?.passwordHash).toBeNull();
    });

    it('an empty-string password hash is rejected too, not passed to bcrypt', async () => {
      const tenant = await prisma.tenant.create({
        data: { name: 'Empty Hash Tenant', slug: `t-${randomUUID()}` },
      });
      createdTenantIds.push(tenant.id);
      const email = `${randomUUID()}@emptyhash.local`;
      const user = await createTestUser(prisma, {
        email,
        passwordHash: '',
        role: UserRole.EMPLOYEE,
        tenantId: tenant.id,
      });
      createdUserIds.push(user.id);
      expect(await service.validateUser(email, TEST_PASSWORD)).toBeNull();
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

    it("login throws Forbidden when the user's only tenant is inactive (zero active memberships)", async () => {
      const { tenant, email } = await createTenantUser();
      await prisma.tenant.update({ where: { id: tenant.id }, data: { isActive: false } });
      const result = await service.validateUser(email, TEST_PASSWORD);
      expect(result).not.toBeNull();
      await expect(service.login(result!)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns the super admin by email (no membership rows)', async () => {
      const { user, email } = await createSuperAdmin();
      const result = await service.validateUser(email, TEST_PASSWORD);
      expect(result?.id).toBe(user.id);
      expect(result?.isSuperAdmin).toBe(true);
      expect(result?.memberships).toHaveLength(0);
    });

    it('login throws Forbidden("No active memberships") for a user with zero memberships', async () => {
      const { user, email } = await createTenantUser();
      await prisma.membership.deleteMany({ where: { userId: user.id } });
      const result = await service.validateUser(email, TEST_PASSWORD);
      expect(result).not.toBeNull();
      await expect(service.login(result!)).rejects.toMatchObject({
        message: 'No active memberships',
      });
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
      expect(after).toBe(before + 1);
    });

    // TKT-0030: guards the per-call expiresIn. The JwtModule registration no longer
    // supplies a default, so if this ever regressed to the library default the
    // effective access-token lifetime would change silently.
    it('issues an access token whose TTL comes from JWT_ACCESS_TTL', async () => {
      const { user } = await createTenantUser();
      const { accessToken } = await service.login(user);
      const decoded = jwt.decode(accessToken) as { iat: number; exp: number };
      expect(decoded.exp - decoded.iat).toBe(15 * 60);
    });

    it('sets the refresh row expiry from JWT_REFRESH_TTL', async () => {
      // Covers parseDurationSeconds via its surviving caller: the TTL string must be
      // parsed into the persisted expiresAt, not silently defaulted.
      const { user } = await createTenantUser(UserRole.ADMIN);
      const issuedAt = Date.now();
      await service.login(user);

      const row = await prisma.refreshToken.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const lifetimeMs = row!.expiresAt.getTime() - issuedAt;
      expect(lifetimeMs).toBeGreaterThan(sevenDaysMs - 60_000);
      expect(lifetimeMs).toBeLessThan(sevenDaysMs + 60_000);
    });

    it('encodes the membership role and tenantId in the access JWT', async () => {
      const { user, tenant } = await createTenantUser(UserRole.ADMIN);
      const { accessToken } = await service.login(user);
      const decoded = jwt.decode(accessToken) as AccessJwtPayload;
      expect(decoded.sub).toBe(user.id);
      expect(decoded.email).toBe(user.email);
      expect(decoded.role).toBe(UserRole.ADMIN);
      expect(decoded.tenantId).toBe(tenant.id);
      expect(decoded.type).toBe('access');
    });

    it('purges the user expired token rows from both tables', async () => {
      const { user: userA } = await createTenantUser();
      const { user: userB } = await createTenantUser();
      const past = new Date(Date.now() - 60_000);
      for (const u of [userA, userB]) {
        await prisma.refreshToken.create({
          data: { tokenHash: randomUUID(), userId: u.id, expiresAt: past },
        });
        await prisma.passwordResetToken.create({
          data: { tokenHash: randomUUID(), userId: u.id, expiresAt: past },
        });
      }

      await service.login(userA);

      // A's expired rows are gone; only the freshly issued refresh row remains.
      await expect(
        prisma.refreshToken.count({ where: { userId: userA.id } }),
      ).resolves.toBe(1);
      await expect(
        prisma.passwordResetToken.count({ where: { userId: userA.id } }),
      ).resolves.toBe(0);
      // B is untouched — the purge is scoped to the acting user.
      await expect(
        prisma.refreshToken.count({ where: { userId: userB.id } }),
      ).resolves.toBe(1);
      await expect(
        prisma.passwordResetToken.count({ where: { userId: userB.id } }),
      ).resolves.toBe(1);
    });

    it('keeps revoked-but-unexpired rows as replay tripwires', async () => {
      const { user } = await createTenantUser();
      const future = new Date(Date.now() + 60_000);
      const tripwire = await prisma.refreshToken.create({
        data: {
          tokenHash: randomUUID(),
          userId: user.id,
          expiresAt: future,
          revokedAt: new Date(),
        },
      });

      await service.login(user);

      // TKT-0026 depends on this row surviving: purging on revokedAt would turn a
      // detected replay into an indistinguishable "row not found".
      await expect(
        prisma.refreshToken.findUnique({ where: { id: tripwire.id } }),
      ).resolves.not.toBeNull();
    });

    it('purges 100 expired rows in one deleteMany per table', async () => {
      const { user } = await createTenantUser();
      const past = new Date(Date.now() - 60_000);
      await prisma.refreshToken.createMany({
        data: Array.from({ length: 100 }, () => ({
          tokenHash: randomUUID(),
          userId: user.id,
          expiresAt: past,
        })),
      });
      // Count calls by wrapping the delegate method directly. vi.spyOn does not
      // survive mockRestore() on Prisma's proxy-backed delegates — it leaves the
      // method broken for every later test in the file — so wrap and restore by
      // hand, delegating with the right `this`.
      const counts = { refresh: 0, reset: 0 };
      const refreshDelegate = prisma.refreshToken as unknown as Record<string, unknown>;
      const resetDelegate = prisma.passwordResetToken as unknown as Record<string, unknown>;
      const refreshOriginal = refreshDelegate.deleteMany as (...a: unknown[]) => unknown;
      const resetOriginal = resetDelegate.deleteMany as (...a: unknown[]) => unknown;
      refreshDelegate.deleteMany = (...args: unknown[]) => {
        counts.refresh += 1;
        return refreshOriginal.apply(prisma.refreshToken, args);
      };
      resetDelegate.deleteMany = (...args: unknown[]) => {
        counts.reset += 1;
        return resetOriginal.apply(prisma.passwordResetToken, args);
      };

      try {
        await service.login(user);
      } finally {
        refreshDelegate.deleteMany = refreshOriginal;
        resetDelegate.deleteMany = resetOriginal;
      }

      expect(counts).toEqual({ refresh: 1, reset: 1 });
      await expect(
        prisma.refreshToken.count({ where: { userId: user.id } }),
      ).resolves.toBe(1);
    });

    it('logs in normally when there is nothing to purge', async () => {
      const { user } = await createTenantUser();
      await expect(service.login(user)).resolves.toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
      });
    });

    it('encodes SUPER_ADMIN/null for super admins (no membership rows)', async () => {
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

      // Old token should now be unusable (TCR TKT-0031: aged past the grace window
      // so this is classified as a replay, which is what the test means).
      await ageOutRevocation(initial.refreshToken);
      await expect(service.refresh(initial.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects an unknown refresh token', async () => {
      await expect(service.refresh('this-is-not-a-real-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('login starts a new token family', async () => {
      const { user } = await createTenantUser();
      const first = await service.login(user);
      const second = await service.login(user);

      const rowA = await rowFor(first.refreshToken);
      const rowB = await rowFor(second.refreshToken);
      expect(rowA!.familyId).toBeTruthy();
      expect(rowB!.familyId).toBeTruthy();
      expect(rowA!.familyId).not.toBe(rowB!.familyId);
    });

    it('rotation keeps the token in the same family', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      const rotated = await service.refresh(initial.refreshToken);

      const before = await rowFor(initial.refreshToken);
      const after = await rowFor(rotated.refreshToken);
      expect(after!.familyId).toBe(before!.familyId);
      expect(after!.id).not.toBe(before!.id);
    });

    it('a replayed refresh token revokes its whole family', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      const rotated = await service.refresh(initial.refreshToken);

      // Replay the already-rotated token, aged past the grace window (TCR TKT-0031).
      await ageOutRevocation(initial.refreshToken);
      await expect(service.refresh(initial.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      // The live sibling in the same family is now revoked too.
      expect((await rowFor(rotated.refreshToken))!.revokedAt).not.toBeNull();
      await expect(service.refresh(rotated.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('family revocation does not touch the user other sessions', async () => {
      const { user } = await createTenantUser();
      const deviceA = await service.login(user);
      const deviceB = await service.login(user);
      const rotatedA = await service.refresh(deviceA.refreshToken);

      await ageOutRevocation(deviceA.refreshToken); // TCR TKT-0031
      await expect(service.refresh(deviceA.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      // Family A is dead...
      expect((await rowFor(rotatedA.refreshToken))!.revokedAt).not.toBeNull();
      // ...but the other login family still works.
      expect((await rowFor(deviceB.refreshToken))!.revokedAt).toBeNull();
      await expect(service.refresh(deviceB.refreshToken)).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });

    it('keeps the rotated row so replay is still detectable', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      // Seeded AFTER login, so only the refresh path's purge can remove it.
      const stale = await prisma.refreshToken.create({
        data: {
          tokenHash: randomUUID(),
          userId: user.id,
          expiresAt: new Date(Date.now() - 60_000),
        },
      });
      await service.refresh(initial.refreshToken);

      // The purge ran (stale row gone) but spared the just-rotated row...
      await expect(
        prisma.refreshToken.findUnique({ where: { id: stale.id } }),
      ).resolves.toBeNull();
      const rotatedRow = await rowFor(initial.refreshToken);
      expect(rotatedRow).not.toBeNull();
      expect(rotatedRow!.revokedAt).not.toBeNull();

      // ...so replaying it is still detected rather than read as "unknown token"
      // (aged past the grace window, TCR TKT-0031 — the point here is that the row
      // survived the purge, not the window classification).
      await ageOutRevocation(initial.refreshToken);
      await expect(service.refresh(initial.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    // TKT-0031 — grace window for benign races (two tabs, or a lost response).
    it('treats an in-window replay with a live successor as a benign race', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      const rotated = await service.refresh(initial.refreshToken);

      // Same token presented again immediately — the second tab losing the race.
      const second = await service.refresh(initial.refreshToken);

      expect(second.accessToken).toBeTruthy();
      expect(second.refreshToken).not.toBe(rotated.refreshToken);
      // Grace collapses the family to one live chain: the winner's token is revoked
      // alongside it, so no fork can outlive the window (TKT-0032, TCR-approved —
      // this previously asserted the winner survived, which is what forked it).
      expect((await rowFor(rotated.refreshToken))!.revokedAt).not.toBeNull();
      const familyId = (await rowFor(second.refreshToken))!.familyId;
      await expect(
        prisma.refreshToken.count({ where: { familyId, revokedAt: null } }),
      ).resolves.toBe(1);
      // The winner is still not logged out — its next refresh is graced in turn.
      await expect(service.refresh(rotated.refreshToken)).resolves.toMatchObject({
        accessToken: expect.any(String),
      });
    });

    it('does not re-stamp revokedAt on the graced token', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      await service.refresh(initial.refreshToken);
      const revokedAtBefore = (await rowFor(initial.refreshToken))!.revokedAt;

      await service.refresh(initial.refreshToken);

      // Sliding the window forward would make one token reusable indefinitely.
      expect((await rowFor(initial.refreshToken))!.revokedAt).toEqual(revokedAtBefore);
    });

    // TKT-0032 — a grace path that leaves the successor live forks the family into
    // two chains. Neither ever presents a revoked row again, so reuse detection is
    // permanently unreachable for that family and a thief keeps access for good.
    it('never lets two chains rotate independently in one family', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      const rotated = await service.refresh(initial.refreshToken);
      const second = await service.refresh(initial.refreshToken); // graced
      const familyId = (await rowFor(second.refreshToken))!.familyId;

      // Both "tabs" keep rotating. If grace forked the family, each would own a
      // live chain and neither would ever trip detection again.
      await service.refresh(rotated.refreshToken);
      await service.refresh(second.refreshToken);

      await expect(
        prisma.refreshToken.count({ where: { familyId, revokedAt: null } }),
      ).resolves.toBe(1);
    });

    it('logs the grace path without leaking the token', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      await service.refresh(initial.refreshToken);
      const familyId = (await rowFor(initial.refreshToken))!.familyId;

      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await service.refresh(initial.refreshToken); // graced

      const logged = warn.mock.calls.map((args) => String(args[0])).join('\n');
      warn.mockRestore();

      expect(logged).toContain(user.id);
      expect(logged).toContain(familyId);
      expect(logged).not.toContain(initial.refreshToken);
      expect(logged).not.toContain(hashOf(initial.refreshToken));
    });

    it('does not grace a token revoked by logout, even within the window', async () => {
      const { user } = await createTenantUser();
      const tokens = await service.login(user);
      await service.logout(tokens.refreshToken);

      // Revoked moments ago, but logout leaves no live successor — so the grace
      // path must not apply, or logout would linger for the whole window.
      await expect(service.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('does not grace tokens revoked by a password reset, even within the window', async () => {
      const { user, email } = await createTenantUser();
      const tokens = await service.login(user);
      await service.requestPasswordReset(email);
      const rawToken = mailMock.sendPasswordReset.mock.calls[0]?.[0]?.resetUrl.split('/').pop();
      await service.completePasswordReset(rawToken as string, 'BrandNewPass123!');

      await expect(service.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('an unknown token revokes nothing', async () => {
      const { user } = await createTenantUser();
      const tokens = await service.login(user);
      const liveBefore = await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      });

      await expect(service.refresh('this-is-not-a-real-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      const liveAfter = await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      });
      expect(liveAfter).toBe(liveBefore);
      expect((await rowFor(tokens.refreshToken))!.revokedAt).toBeNull();
    });

    it('logs a replay warning without leaking the token', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      await service.refresh(initial.refreshToken);
      const familyId = (await rowFor(initial.refreshToken))!.familyId;
      await ageOutRevocation(initial.refreshToken); // TCR TKT-0031

      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await expect(service.refresh(initial.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      const logged = warn.mock.calls.map((args) => String(args[0])).join('\n');
      warn.mockRestore();

      expect(logged).toContain(user.id);
      expect(logged).toContain(familyId);
      expect(logged).not.toContain(initial.refreshToken);
      expect(logged).not.toContain(hashOf(initial.refreshToken));
    });

    it('rejects an expired refresh token', async () => {
      const { user } = await createTenantUser();
      const tokens = await service.login(user);
      await prisma.refreshToken.update({
        where: { tokenHash: hashOf(tokens.refreshToken) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(service.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rotates inside a single transaction', async () => {
      const { user } = await createTenantUser();
      const initial = await service.login(user);
      const tx = vi.spyOn(prisma, '$transaction');

      const rotated = await service.refresh(initial.refreshToken);

      // Assert before restoring — mockRestore() also clears the call history.
      expect(tx).toHaveBeenCalledOnce();
      tx.mockRestore();

      // Post-state is consistent: old row revoked, exactly one live row in the family.
      const familyId = (await rowFor(rotated.refreshToken))!.familyId;
      expect((await rowFor(initial.refreshToken))!.revokedAt).not.toBeNull();
      await expect(
        prisma.refreshToken.count({ where: { familyId, revokedAt: null } }),
      ).resolves.toBe(1);
    });

    // TKT-0004 AC #4: global isActive lockout holds regardless of memberships.
    it('rejects a deactivated account', async () => {
      const { user } = await createTenantUser();
      const tokens = await service.login(user);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await expect(service.refresh(tokens.refreshToken)).rejects.toBeInstanceOf(
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

    // TKT-0058 AC #8: a pending account is isActive, so the early return at the top of
    // requestPasswordReset does not fire. This is the self-recovery path for an invite
    // whose 48h link expired — the person can issue themselves a fresh one.
    it('issues a token for a pending account (never-accepted invite)', async () => {
      const tenant = await prisma.tenant.create({
        data: { name: 'Pending Reset Tenant', slug: `t-${randomUUID()}` },
      });
      createdTenantIds.push(tenant.id);
      const email = `${randomUUID()}@pendingreset.local`;
      const pending = await createTestUser(prisma, {
        email,
        passwordHash: null,
        role: UserRole.CUSTOMER,
        tenantId: tenant.id,
      });
      createdUserIds.push(pending.id);

      await service.requestPasswordReset(email);

      const rows = await prisma.passwordResetToken.findMany({ where: { userId: pending.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.usedAt).toBeNull();
      expect(mailMock.sendPasswordReset).toHaveBeenCalledOnce();
    });
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

  describe('changeOwnPassword', () => {
    it('updates the password and revokes all refresh tokens, given the correct current password', async () => {
      const { user, email } = await createTenantUser();
      // Issue a refresh token — must end up revoked after the change.
      const before = await service.login(user as never);
      const beforeRow = await rowFor(before.refreshToken);
      expect(beforeRow?.revokedAt).toBeNull();

      await service.changeOwnPassword(user.id, TEST_PASSWORD, 'BrandNewPassw0rd!');

      // Password actually changed — reauth with the new password now succeeds.
      const reauthed = await service.validateUser(email, 'BrandNewPassw0rd!');
      expect(reauthed?.id).toBe(user.id);
      // The old password no longer works.
      expect(await service.validateUser(email, TEST_PASSWORD)).toBeNull();

      // Refresh token revoked.
      const afterRow = await rowFor(before.refreshToken);
      expect(afterRow?.revokedAt).not.toBeNull();
    });

    it('rejects the wrong current password and leaves the password unchanged', async () => {
      const { user, email } = await createTenantUser();
      await expect(
        service.changeOwnPassword(user.id, 'NotTheRealPassword!', 'BrandNewPassw0rd!'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await service.validateUser(email, TEST_PASSWORD)).not.toBeNull();
    });

    it('rejects an unknown user id', async () => {
      await expect(
        service.changeOwnPassword(randomUUID(), TEST_PASSWORD, 'BrandNewPassw0rd!'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the user has been deactivated', async () => {
      const { user } = await createTenantUser();
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      await expect(
        service.changeOwnPassword(user.id, TEST_PASSWORD, 'BrandNewPassw0rd!'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
