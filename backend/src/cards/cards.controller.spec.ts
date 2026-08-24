import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BillingMode, FeeStatus, UserRole } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { CardsModule } from './cards.module';
import { usableCardsByTrainee } from './card-consumption';
import { createTestUser } from '@/test-utils/create-user';
import { createTestCard } from '@/test-utils/create-card';

const PASSWORD = 'TestPass123!';

describe('CardsController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
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
        CardsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // AppModule registers this as an APP_INTERCEPTOR; this spec builds its own module graph,
    // so it wires the interceptor the same way it wires the ValidationPipe above.
    app.useGlobalInterceptors(
      new ResponseSchemaInterceptor(app.get(Reflector), app.get(ConfigService)),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await app.close();
  });

  async function setupActor(role: UserRole) {
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
      // TKT-0054: ADMIN and EMPLOYEE are both location-scoped, so both need an assignment.
      ...(role === UserRole.ADMIN || role === UserRole.EMPLOYEE
        ? { locations: { connect: [{ id: location.id }] } }
        : {}),
    });
    const tokens = await auth.login(user);
    return {
      tenantId: tenant.id,
      userId: user.id,
      locationId: location.id,
      accessToken: tokens.accessToken,
    };
  }
  async function newTrainee(tenantId: string) {
    return prisma.trainee.create({
      data: { tenantId, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
    });
  }
  async function newClass(tenantId: string, locationId?: string) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: 100,
        locations: locationId ? { connect: [{ id: locationId }] } : undefined,
      },
    });
  }

  describe('POST /cards', () => {
    it('admin sells a tenant-wide card (201): card + UNPAID class-less fee in one sale', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);

      const res = await request(server)
        .post('/cards')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: tr.id, totalVisits: 12, price: 120 })
        .expect(201);

      expect(res.body).toMatchObject({
        traineeId: tr.id,
        classId: null,
        totalVisits: 12,
        price: '120',
        expiresAt: null,
        cancelledAt: null,
        visitsUsed: 0,
        visitsRemaining: 12,
      });

      const fee = await prisma.fee.findUnique({ where: { id: res.body.feeId } });
      expect(fee).toMatchObject({
        tenantId: a.tenantId,
        classId: null,
        traineeId: tr.id,
        status: FeeStatus.UNPAID,
      });
      expect(Number(fee?.amount)).toBe(120);
    });

    it('class-scoped card carries the classId on both card and fee', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newClass(a.tenantId, a.locationId);

      const res = await request(server)
        .post('/cards')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: tr.id, classId: cls.id, totalVisits: 10, price: 80, expiresAt: '2027-01-01' })
        .expect(201);

      expect(res.body.classId).toBe(cls.id);
      expect(res.body.expiresAt).toBe('2027-01-01T00:00:00.000Z');
      const fee = await prisma.fee.findUnique({ where: { id: res.body.feeId } });
      expect(fee?.classId).toBe(cls.id);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const tr = await newTrainee(a.tenantId);
      await request(server)
        .post('/cards')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: tr.id, totalVisits: 12, price: 120 })
        .expect(403);
    });

    it('rejects invalid input (400): zero visits, negative price, unknown trainee, cross-tenant class', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const other = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const foreignClass = await newClass(other.tenantId);

      const post = (body: object) =>
        request(server)
          .post('/cards')
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .send(body);

      await post({ traineeId: tr.id, totalVisits: 0, price: 120 }).expect(400);
      await post({ traineeId: tr.id, totalVisits: 12, price: -1 }).expect(400);
      await post({ traineeId: 'nope', totalVisits: 12, price: 120 }).expect(400);
      await post({ traineeId: tr.id, classId: foreignClass.id, totalVisits: 12, price: 120 }).expect(400);
    });
  });

  describe('GET /cards', () => {
    it('lists paginated card rows with computed visit counters', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      await request(server)
        .post('/cards')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: tr.id, totalVisits: 12, price: 120 })
        .expect(201);

      const res = await request(server)
        .get('/cards')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(Object.keys(res.body).sort()).toEqual([
        'items',
        'page',
        'pageSize',
        'total',
        'totalPages',
      ]);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({
        traineeId: tr.id,
        visitsUsed: 0,
        visitsRemaining: 12,
        price: '120',
      });
    });

    it('filters by traineeId and lets an employee read', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr1 = await newTrainee(a.tenantId);
      const tr2 = await newTrainee(a.tenantId);
      for (const tr of [tr1, tr2]) {
        await request(server)
          .post('/cards')
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .send({ traineeId: tr.id, totalVisits: 5, price: 50 })
          .expect(201);
      }

      const res = await request(server)
        .get(`/cards?traineeId=${tr1.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].traineeId).toBe(tr1.id);
    });

    // TKT-0123: POST and cancel both apply assertClassAccessible, and GET /fees scopes the
    // equivalent money rows — this list took no viewer at all, so every card in the club was
    // readable from any hall.
    describe('location scope', () => {
      async function cardInAnotherHall(a: { tenantId: string; locationId: string }) {
        const other = await prisma.location.create({
          data: { tenantId: a.tenantId, name: `Other-${randomUUID()}` },
        });
        const theirClass = await newClass(a.tenantId, other.id);
        const tr = await newTrainee(a.tenantId);
        const fee = await prisma.fee.create({
          data: {
            tenantId: a.tenantId,
            classId: theirClass.id,
            traineeId: tr.id,
            periodStart: new Date('2026-05-01T00:00:00Z'),
            periodEnd: new Date('2026-05-31T00:00:00Z'),
            amount: 90,
          },
        });
        const card = await prisma.card.create({
          data: {
            tenantId: a.tenantId,
            traineeId: tr.id,
            classId: theirClass.id,
            feeId: fee.id,
            totalVisits: 9,
            price: 90,
          },
        });
        return { card, other };
      }

      it("hides a card scoped to another hall's class from a location-scoped admin", async () => {
        const a = await setupActor(UserRole.ADMIN);
        const { card } = await cardInAnotherHall(a);

        const res = await request(server)
          .get('/cards')
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .expect(200);
        expect(res.body.items.map((c: { id: string }) => c.id)).not.toContain(card.id);
      });

      it('shows the same card to a SUPER_ADMIN', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const { card } = await cardInAnotherHall(a);
        const sa = await setupActor(UserRole.SUPER_ADMIN);

        const res = await request(server)
          .get('/cards')
          .set('Authorization', `Bearer ${sa.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .expect(200);
        expect(res.body.items.map((c: { id: string }) => c.id)).toContain(card.id);
      });

      // Whole-club cards carry no class, so they are tenant-level money — the same call
      // TKT-0106 made for class-less fees.
      it('keeps a whole-club card visible to every admin', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const tr = await newTrainee(a.tenantId);
        const created = await request(server)
          .post('/cards')
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .send({ traineeId: tr.id, totalVisits: 4, price: 40 })
          .expect(201);

        const res = await request(server)
          .get('/cards')
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .expect(200);
        expect(res.body.items.map((c: { id: string }) => c.id)).toContain(created.body.id);
      });
    });
  });

  // TKT-0115: cancel is one-way — sets cancelledAt, the shared usable-card filter does the rest.
  describe('POST /cards/:id/cancel', () => {
    async function sellCard(a: Awaited<ReturnType<typeof setupActor>>, totalVisits = 12) {
      const tr = await newTrainee(a.tenantId);
      const res = await request(server)
        .post('/cards')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeId: tr.id, totalVisits, price: 120 })
        .expect(201);
      return { card: res.body as { id: string; feeId: string }, trainee: tr };
    }

    it('admin cancels a card (201): cancelledAt set, counters intact, consumption stops seeing it', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId, a.locationId);
      const { card, trainee } = await sellCard(a);

      const res = await request(server)
        .post(`/cards/${card.id}/cancel`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(201);
      expect(res.body.id).toBe(card.id);
      expect(res.body.cancelledAt).not.toBeNull();
      expect(res.body).toMatchObject({ visitsUsed: 0, visitsRemaining: 12 });

      // AC #4 tie-in: the endpoint's write flows through the single usable-card source
      // (consumption + candidates both read it — TKT-0107/0108 pin the filter itself).
      const usable = await usableCardsByTrainee(prisma, {
        tenantId: a.tenantId,
        classId: cls.id,
        traineeIds: [trainee.id],
      });
      expect(usable.get(trainee.id)).toBeUndefined();
    });

    it('second cancel returns 400 CARD_ALREADY_CANCELLED', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { card } = await sellCard(a);
      const cancel = () =>
        request(server)
          .post(`/cards/${card.id}/cancel`)
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId);
      await cancel().expect(201);
      const res = await cancel().expect(400);
      expect(res.body.code).toBe('CARD_ALREADY_CANCELLED');
    });

    it('returns 403 for employee', async () => {
      const admin = await setupActor(UserRole.ADMIN);
      const employee = await setupActor(UserRole.EMPLOYEE);
      const { card } = await sellCard(admin);
      await request(server)
        .post(`/cards/${card.id}/cancel`)
        .set('Authorization', `Bearer ${employee.accessToken}`)
        .set('X-Tenant-Id', employee.tenantId)
        .expect(403);
    });

    it('returns 404 when the card is in another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const { card } = await sellCard(b);
      await request(server)
        .post(`/cards/${card.id}/cancel`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(404);
    });
  });

  describe('GET /me/cards (TKT-0116)', () => {
    async function customerActor(tenantId: string) {
      const user = await createTestUser(prisma, {
        email: `${randomUUID()}@x`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.CUSTOMER,
        tenantId,
      });
      const tokens = await auth.login(user);
      return { userId: user.id, accessToken: tokens.accessToken };
    }
    const myCards = (tenantId: string, accessToken: string) =>
      request(server)
        .get('/me/cards')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Tenant-Id', tenantId);

    it('returns linked + guarded trainees, and never another family (AC #1)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const customer = await customerActor(a.tenantId);
      const linked = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId, firstName: 'Linked', lastName: 'Kid',
          dateOfBirth: new Date('2000-01-01'), userId: customer.userId,
        },
      });
      const guarded = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId, firstName: 'Guarded', lastName: 'Kid',
          dateOfBirth: new Date('2012-01-01'),
          guardians: { connect: [{ id: customer.userId }] },
        },
      });
      const stranger = await newTrainee(a.tenantId);
      await createTestCard(prisma, { tenantId: a.tenantId, traineeId: linked.id, totalVisits: 12 });
      await createTestCard(prisma, { tenantId: a.tenantId, traineeId: guarded.id, totalVisits: 8 });
      await createTestCard(prisma, { tenantId: a.tenantId, traineeId: stranger.id, totalVisits: 5 });

      const res = await myCards(a.tenantId, customer.accessToken).expect(200);
      const traineeIds = (res.body as { traineeId: string }[]).map((c) => c.traineeId).sort();
      expect(traineeIds).toEqual([linked.id, guarded.id].sort());
      const guardedRow = (res.body as { traineeId: string; trainee: { firstName: string } }[]).find(
        (c) => c.traineeId === guarded.id,
      )!;
      expect(guardedRow.trainee.firstName).toBe('Guarded');
    });

    it('carries live counters, the class scope, and the cancelled flag (AC #1)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const customer = await customerActor(a.tenantId);
      const trainee = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId, firstName: 'L', lastName: 'K',
          dateOfBirth: new Date('2000-01-01'), userId: customer.userId,
        },
      });
      const cls = await newClass(a.tenantId, a.locationId);
      const scoped = await createTestCard(prisma, {
        tenantId: a.tenantId, traineeId: trainee.id, classId: cls.id, totalVisits: 10,
      });
      const wide = await createTestCard(prisma, {
        tenantId: a.tenantId, traineeId: trainee.id, totalVisits: 4,
        cancelledAt: new Date('2026-08-01T00:00:00Z'),
      });
      // One consumed visit on the scoped card, through a real booking row.
      const session = await prisma.session.create({
        data: {
          tenantId: a.tenantId, classId: cls.id, locationId: a.locationId,
          startsAt: new Date('2026-06-01T18:00:00Z'), endsAt: new Date('2026-06-01T19:00:00Z'),
        },
      });
      const attendance = await prisma.attendance.create({
        data: { tenantId: a.tenantId, sessionId: session.id, traineeId: trainee.id },
      });
      await prisma.cardConsumption.create({
        data: { tenantId: a.tenantId, cardId: scoped.id, attendanceId: attendance.id },
      });

      const res = await myCards(a.tenantId, customer.accessToken).expect(200);
      const rows = res.body as {
        id: string;
        totalVisits: number;
        visitsUsed: number;
        visitsRemaining: number;
        cancelledAt: string | null;
        class: { id: string; name: string } | null;
      }[];
      const scopedRow = rows.find((c) => c.id === scoped.id)!;
      expect(scopedRow.visitsUsed).toBe(1);
      expect(scopedRow.visitsRemaining).toBe(9);
      expect(scopedRow.class).toEqual({ id: cls.id, name: cls.name });
      expect(scopedRow.cancelledAt).toBeNull();
      const wideRow = rows.find((c) => c.id === wide.id)!;
      expect(wideRow.class).toBeNull();
      expect(wideRow.cancelledAt).not.toBeNull();
    });

    it('rejects staff roles (403)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await myCards(a.tenantId, a.accessToken).expect(403);
    });
  });
});
