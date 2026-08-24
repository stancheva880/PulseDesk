import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { BillingMode, UserRole } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { WaitlistsModule } from './waitlists.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';
const HOUR = 3600_000;

/**
 * TKT-0122 ACs #2-#4. The sweep is platform-wide on purpose — a scheduled job has no tenant
 * context, so the endpoint reads no `X-Tenant-Id` and the delete carries no tenant filter.
 * That is exactly why the two-tenant case below matters: the guard against a runaway is the
 * `startsAt` cutoff, not a tenant scope.
 */
describe('WaitlistSweepController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const tenantIds: string[] = [];
  const userIds: string[] = [];
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        LocationScopeModule,
        AuthModule,
        MailModule,
        WaitlistsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(
      new ResponseSchemaInterceptor(app.get(Reflector), app.get(ConfigService)),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await app.close();
  });

  async function newTenant() {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test', slug: `t-${randomUUID()}` },
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  async function actor(role: UserRole, tenantId?: string) {
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@x`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role,
      ...(role === UserRole.SUPER_ADMIN ? {} : { tenantId }),
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);
    return tokens.accessToken;
  }

  /** A session at `startsAt` with one queued trainee and one claim token on that entry. */
  async function queuedSession(tenantId: string, startsAt: Date) {
    const location = await prisma.location.create({
      data: { tenantId, name: `Loc-${randomUUID()}` },
    });
    const cls = await prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 5,
        capacity: 1,
        locations: { connect: [{ id: location.id }] },
      },
    });
    const session = await prisma.session.create({
      data: {
        tenantId,
        classId: cls.id,
        locationId: location.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + HOUR),
      },
    });
    const trainee = await prisma.trainee.create({
      data: {
        tenantId,
        firstName: 'Q',
        lastName: randomUUID().slice(0, 8),
        dateOfBirth: new Date('2000-01-01'),
      },
    });
    const entry = await prisma.waitlistEntry.create({
      data: { tenantId, sessionId: session.id, traineeId: trainee.id },
    });
    const token = await prisma.waitlistClaimToken.create({
      data: {
        tenantId,
        sessionId: session.id,
        entryId: entry.id,
        tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
      },
    });
    // An attendance row on the same past session — the sweep must not touch the historical
    // record, only the queue.
    const attendance = await prisma.attendance.create({
      data: { tenantId, sessionId: session.id, traineeId: trainee.id },
    });
    return { session, entry, token, attendance };
  }

  const sweep = (accessToken: string) =>
    request(server).post('/waitlists/sweep').set('Authorization', `Bearer ${accessToken}`);

  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * HOUR);
  const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR);
  const inDays = (n: number) => new Date(Date.now() + n * 24 * HOUR);

  // Branched rather than indexed: `prisma[model]` is a union of two delegates, and tsc rejects
  // the call because their overloads do not unify (TS2349).
  const exists = async (model: 'waitlistEntry' | 'waitlistClaimToken', id: string) =>
    (await (model === 'waitlistEntry'
      ? prisma.waitlistEntry.count({ where: { id } })
      : prisma.waitlistClaimToken.count({ where: { id } }))) === 1;

  it('deletes stale entries across every tenant and leaves future ones alone', async () => {
    const a = await newTenant();
    const b = await newTenant();
    const su = await actor(UserRole.SUPER_ADMIN);

    const staleA = await queuedSession(a.id, daysAgo(3));
    const staleB = await queuedSession(b.id, daysAgo(3));
    const liveA = await queuedSession(a.id, inDays(3));
    const liveB = await queuedSession(b.id, inDays(3));

    const res = await sweep(su).expect(201);
    expect(res.body.deleted).toBe(2);

    // Both tenants' stale queues are gone...
    expect(await exists('waitlistEntry', staleA.entry.id)).toBe(false);
    expect(await exists('waitlistEntry', staleB.entry.id)).toBe(false);
    // ...and their claim tokens went with them, through the WaitlistClaimToken.entry cascade.
    expect(await exists('waitlistClaimToken', staleA.token.id)).toBe(false);
    expect(await exists('waitlistClaimToken', staleB.token.id)).toBe(false);

    // Future queues untouched in both tenants.
    expect(await exists('waitlistEntry', liveA.entry.id)).toBe(true);
    expect(await exists('waitlistEntry', liveB.entry.id)).toBe(true);
    expect(await exists('waitlistClaimToken', liveA.token.id)).toBe(true);
    expect(await exists('waitlistClaimToken', liveB.token.id)).toBe(true);

    // Attendance is the historical record and is never queue state.
    expect(await prisma.attendance.count({ where: { id: staleA.attendance.id } })).toBe(1);
    expect(await prisma.session.count({ where: { id: staleA.session.id } })).toBe(1);
  });

  // Pins 48 hours as a decision the code actually holds, not a comment.
  it('keeps an entry 47h after the session started and sweeps it at 49h', async () => {
    const t = await newTenant();
    const su = await actor(UserRole.SUPER_ADMIN);
    const justInside = await queuedSession(t.id, hoursAgo(47));
    const justOutside = await queuedSession(t.id, hoursAgo(49));

    const res = await sweep(su).expect(201);
    expect(res.body.deleted).toBe(1);
    expect(await exists('waitlistEntry', justInside.entry.id)).toBe(true);
    expect(await exists('waitlistEntry', justOutside.entry.id)).toBe(false);
  });

  it('is idempotent: a second run deletes nothing and does not throw', async () => {
    const t = await newTenant();
    const su = await actor(UserRole.SUPER_ADMIN);
    await queuedSession(t.id, daysAgo(5));

    expect((await sweep(su).expect(201)).body.deleted).toBe(1);
    expect((await sweep(su).expect(201)).body.deleted).toBe(0);
  });

  it('is SUPER_ADMIN only', async () => {
    const t = await newTenant();
    const admin = await actor(UserRole.ADMIN, t.id);
    const employee = await actor(UserRole.EMPLOYEE, t.id);

    await request(server)
      .post('/waitlists/sweep')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Tenant-Id', t.id)
      .expect(403);
    await request(server)
      .post('/waitlists/sweep')
      .set('Authorization', `Bearer ${employee}`)
      .set('X-Tenant-Id', t.id)
      .expect(403);
  });
});
