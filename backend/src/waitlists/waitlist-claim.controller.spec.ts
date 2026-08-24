import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BillingMode, SessionStatus, UserRole, WaitlistMode } from '@prisma/client';
import { AttendancesModule } from '@/attendances/attendances.module';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { MailService } from '@/mail/mail.service';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { WaitlistsModule } from './waitlists.module';
import { createTestUser } from '@/test-utils/create-user';
import { createTestCard } from '@/test-utils/create-card';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  userId: string;
  locationId: string;
  accessToken: string;
}

describe('Waitlist claim (TKT-0114, e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let mail: MailService;
  let offerSpy: MockInstance;
  let filledSpy: MockInstance;
  const tenantIds: string[] = [];
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        LocationScopeModule,
        AuthModule,
        MailModule,
        AttendancesModule,
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
    mail = moduleRef.get(MailService);
    server = app.getHttpServer();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await app.close();
  });

  function spyOnMail() {
    offerSpy = vi.spyOn(mail, 'sendWaitlistClaimOffer').mockResolvedValue(undefined);
    filledSpy = vi.spyOn(mail, 'sendWaitlistSpotFilled').mockResolvedValue(undefined);
  }
  const tokenOf = (call: unknown[]): string => {
    const url = (call[0] as { claimUrl: string }).claimUrl;
    const token = new URL(url).searchParams.get('token');
    expect(token).toBeTruthy();
    return token!;
  };

  async function setupActor(role: UserRole): Promise<TestActor> {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test', slug: `t-${randomUUID()}` },
    });
    tenantIds.push(tenant.id);
    const location = await prisma.location.create({
      data: { tenantId: tenant.id, name: `Main-${randomUUID()}` },
    });
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@x`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role,
      tenantId: tenant.id,
      locations: { connect: [{ id: location.id }] },
    });
    const tokens = await auth.login(user);
    return {
      tenantId: tenant.id,
      userId: user.id,
      locationId: location.id,
      accessToken: tokens.accessToken,
    };
  }
  const send = (a: TestActor) => ({
    Authorization: `Bearer ${a.accessToken}`,
    'X-Tenant-Id': a.tenantId,
  });

  /** Trainee with a linked CUSTOMER account so claim offers have a recipient. */
  async function linkedTrainee(tenantId: string) {
    const account = await createTestUser(prisma, {
      email: `${randomUUID()}@claim.example`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.CUSTOMER,
      tenantId,
    });
    const trainee = await prisma.trainee.create({
      data: {
        tenantId,
        firstName: 'T',
        lastName: randomUUID().slice(0, 8),
        dateOfBirth: new Date('2000-01-01'),
        userId: account.id,
      },
    });
    return { trainee, email: account.email };
  }

  async function claimSession(
    a: TestActor,
    opts: {
      capacity?: number;
      waitlistMode?: WaitlistMode;
      startsAt?: Date;
      /** Minutes before startsAt when self-service closes. Implies allowSelfBooking. */
      cutoff?: number;
    } = {},
  ) {
    const cls = await prisma.class.create({
      data: {
        tenantId: a.tenantId,
        name: `Claim-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        capacity: opts.capacity ?? 1,
        waitlistMode: opts.waitlistMode ?? WaitlistMode.CLAIM,
        // The service refuses a cutoff without the flag, so the fixture holds the same pair.
        ...(opts.cutoff === undefined
          ? {}
          : { allowSelfBooking: true, bookingCutoffMin: opts.cutoff }),
        locations: { connect: [{ id: a.locationId }] },
      },
    });
    const session = await prisma.session.create({
      data: {
        tenantId: a.tenantId,
        classId: cls.id,
        locationId: a.locationId,
        startsAt: opts.startsAt ?? new Date('2026-12-01T10:00:00Z'),
        endsAt: new Date('2026-12-01T11:00:00Z'),
        status: SessionStatus.SCHEDULED,
      },
    });
    return { cls, session };
  }
  const attend = (tenantId: string, sessionId: string, traineeId: string) =>
    prisma.attendance.create({ data: { tenantId, sessionId, traineeId } });
  const queue = (tenantId: string, sessionId: string, traineeId: string, createdAt: string) =>
    prisma.waitlistEntry.create({
      data: { tenantId, sessionId, traineeId, createdAt: new Date(createdAt) },
    });
  const free = (a: TestActor, sessionId: string, attendanceId: string) =>
    request(server).delete(`/sessions/${sessionId}/attendances/${attendanceId}`).set(send(a));
  const claim = (token: string) => request(server).post('/waitlist/claim').send({ token });

  /** Full CLAIM session with two queued linked trainees; frees the spot and returns the offers. */
  async function openedWindow(a: TestActor) {
    const { cls, session } = await claimSession(a);
    const sitting = await prisma.trainee.create({
      data: { tenantId: a.tenantId, firstName: 'S', lastName: 'It', dateOfBirth: new Date('2000-01-01') },
    });
    const row = await attend(a.tenantId, session.id, sitting.id);
    const first = await linkedTrainee(a.tenantId);
    const second = await linkedTrainee(a.tenantId);
    await queue(a.tenantId, session.id, first.trainee.id, '2026-05-01T08:00:00Z');
    await queue(a.tenantId, session.id, second.trainee.id, '2026-05-01T09:00:00Z');
    spyOnMail();
    await free(a, session.id, row.id).expect(204);
    return { cls, session, first, second };
  }

  it('a freeing delete mails every queued entry a hashed one-time claim link (AC #1)', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { session, first, second } = await openedWindow(a);

    expect(offerSpy).toHaveBeenCalledTimes(2);
    const recipients = offerSpy.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(recipients).toEqual([first.email, second.email].sort());

    const rows = await prisma.waitlistClaimToken.findMany({ where: { sessionId: session.id } });
    expect(rows).toHaveLength(2);
    const mailedTokens = offerSpy.mock.calls.map((c) => tokenOf(c));
    for (const row of rows) {
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(mailedTokens).not.toContain(row.tokenHash);
    }
    for (const call of offerSpy.mock.calls) {
      expect((call[0] as { claimUrl: string }).claimUrl).toContain('/claim?token=');
    }
  });

  it('a FIFO_AUTO delete sends no claim offers', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { session } = await claimSession(a, { waitlistMode: WaitlistMode.FIFO_AUTO });
    const sitting = await prisma.trainee.create({
      data: { tenantId: a.tenantId, firstName: 'S', lastName: 'It', dateOfBirth: new Date('2000-01-01') },
    });
    const row = await attend(a.tenantId, session.id, sitting.id);
    spyOnMail();
    await free(a, session.id, row.id).expect(204);
    expect(offerSpy).not.toHaveBeenCalled();
  });

  // TKT-0120: past the cutoff (here: past the start itself) no window opens at all — no tokens,
  // no mail. The queue entry survives; only a sweeper will ever clear it.
  it('freeing a spot on a session that already started opens no claim window', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { session } = await claimSession(a, { startsAt: new Date('2020-01-01T10:00:00Z') });
    const sitting = await prisma.trainee.create({
      data: { tenantId: a.tenantId, firstName: 'S', lastName: 'It', dateOfBirth: new Date('2000-01-01') },
    });
    const row = await attend(a.tenantId, session.id, sitting.id);
    const { trainee } = await linkedTrainee(a.tenantId);
    await queue(a.tenantId, session.id, trainee.id, '2026-05-01T08:00:00Z');
    spyOnMail();

    await free(a, session.id, row.id).expect(204);

    expect(offerSpy).not.toHaveBeenCalled();
    expect(await prisma.waitlistClaimToken.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.waitlistEntry.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it('the first valid claim books, consumes a visit, and deletes the entry (AC #2)', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { cls, session, first } = await openedWindow(a);
    const card = await createTestCard(prisma, {
      tenantId: a.tenantId,
      traineeId: first.trainee.id,
      totalVisits: 5,
    });
    const firstToken = tokenOf(
      offerSpy.mock.calls.find((c) => (c[0] as { to: string }).to === first.email)!,
    );

    const res = await claim(firstToken).expect(200);
    expect(res.body.claimed).toBe(true);
    expect(res.body.className).toBe(cls.name);

    const booked = await prisma.attendance.findFirstOrThrow({
      where: { sessionId: session.id, traineeId: first.trainee.id },
    });
    expect(
      await prisma.cardConsumption.count({ where: { cardId: card.id, attendanceId: booked.id } }),
    ).toBe(1);
    expect(
      await prisma.waitlistEntry.count({
        where: { sessionId: session.id, traineeId: first.trainee.id },
      }),
    ).toBe(0);
  });

  it('a later claim for the same opening answers 409 SPOT_TAKEN without session details (AC #2, #4)', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { first, second } = await openedWindow(a);
    const t1 = tokenOf(offerSpy.mock.calls.find((c) => (c[0] as { to: string }).to === first.email)!);
    const t2 = tokenOf(offerSpy.mock.calls.find((c) => (c[0] as { to: string }).to === second.email)!);

    await claim(t1).expect(200);
    const res = await claim(t2).expect(409);
    expect(res.body.code).toBe('SPOT_TAKEN');
    expect(res.body.className).toBeUndefined();
    expect(res.body.startsAt).toBeUndefined();
  });

  it('a used token answers 410 (AC #4)', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { first } = await openedWindow(a);
    const t1 = tokenOf(offerSpy.mock.calls.find((c) => (c[0] as { to: string }).to === first.email)!);
    await claim(t1).expect(200);
    await claim(t1).expect(410);
  });

  it('an unknown token answers 410 without details (AC #4)', async () => {
    const res = await claim(randomBytes(32).toString('base64url')).expect(410);
    expect(res.body.className).toBeUndefined();
  });

  it('a token for a session that already started answers 410 (AC #4)', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { session } = await claimSession(a, { startsAt: new Date('2020-01-01T10:00:00Z') });
    const { trainee } = await linkedTrainee(a.tenantId);
    const entry = await queue(a.tenantId, session.id, trainee.id, '2026-05-01T08:00:00Z');
    const raw = randomBytes(32).toString('base64url');
    await prisma.waitlistClaimToken.create({
      data: {
        tenantId: a.tenantId,
        sessionId: session.id,
        entryId: entry.id,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
      },
    });
    await claim(raw).expect(410);
  });

  // TKT-0123: the window is not the only gate. openClaimWindow refuses to open past the cutoff,
  // but a token minted before it must not keep booking after it — the claim door is public and
  // a booking there spends a card visit, so it has to answer to the class's cutoff too.
  it('a token presented inside the booking cutoff answers 410, session not yet started', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const startsAt = new Date(Date.now() + 30 * 60_000);
    const { session } = await claimSession(a, { startsAt, cutoff: 60 });
    const { trainee } = await linkedTrainee(a.tenantId);
    const entry = await queue(a.tenantId, session.id, trainee.id, '2026-05-01T08:00:00Z');
    const raw = randomBytes(32).toString('base64url');
    await prisma.waitlistClaimToken.create({
      data: {
        tenantId: a.tenantId,
        sessionId: session.id,
        entryId: entry.id,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
      },
    });

    const res = await claim(raw).expect(410);
    expect(res.body.code).toBe('WAITLIST_CLAIM_GONE');
    // Nothing was booked and no visit was drawn.
    expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(0);
    expect(await prisma.waitlistEntry.count({ where: { id: entry.id } })).toBe(1);
  });

  it('a token stays claimable while the session is outside the cutoff', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const startsAt = new Date(Date.now() + 6 * 60 * 60_000);
    const { session } = await claimSession(a, { startsAt, cutoff: 60 });
    const { trainee } = await linkedTrainee(a.tenantId);
    const entry = await queue(a.tenantId, session.id, trainee.id, '2026-05-01T08:00:00Z');
    const raw = randomBytes(32).toString('base64url');
    await prisma.waitlistClaimToken.create({
      data: {
        tenantId: a.tenantId,
        sessionId: session.id,
        entryId: entry.id,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
      },
    });

    await claim(raw).expect(200);
    expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(1);
  });

  it('removing the entry voids its token (AC #4)', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { first } = await openedWindow(a);
    const t1 = tokenOf(offerSpy.mock.calls.find((c) => (c[0] as { to: string }).to === first.email)!);
    await prisma.waitlistEntry.deleteMany({ where: { traineeId: first.trainee.id } });
    await claim(t1).expect(410);
  });

  it('a refilling claim mails the rest "spot filled again" (AC #3)', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { first, second } = await openedWindow(a);
    const t1 = tokenOf(offerSpy.mock.calls.find((c) => (c[0] as { to: string }).to === first.email)!);

    await claim(t1).expect(200);

    expect(filledSpy).toHaveBeenCalledTimes(1);
    expect((filledSpy.mock.calls[0]![0] as { to: string }).to).toBe(second.email);
  });

  it('the next opening voids old tokens and issues fresh ones (AC #3, #4)', async () => {
    const a = await setupActor(UserRole.ADMIN);
    const { session, first, second } = await openedWindow(a);
    const t1 = tokenOf(offerSpy.mock.calls.find((c) => (c[0] as { to: string }).to === first.email)!);
    const staleT2 = tokenOf(
      offerSpy.mock.calls.find((c) => (c[0] as { to: string }).to === second.email)!,
    );

    await claim(t1).expect(200);
    const winnersRow = await prisma.attendance.findFirstOrThrow({
      where: { sessionId: session.id, traineeId: first.trainee.id },
    });
    offerSpy.mockClear();
    await free(a, session.id, winnersRow.id).expect(204);

    expect(offerSpy).toHaveBeenCalledTimes(1);
    const freshT2 = tokenOf(offerSpy.mock.calls[0]!);
    await claim(staleT2).expect(410);
    const res = await claim(freshT2).expect(200);
    expect(res.body.claimed).toBe(true);
  });
});
