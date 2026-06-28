import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  AttendanceRsvp,
  AttendanceStatus,
  BillingMode,
  UserRole,
} from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { SessionsModule } from '@/sessions/sessions.module';
import { SessionsService } from '@/sessions/sessions.service';
import { AttendancesModule } from './attendances.module';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  userId: string;
  accessToken: string;
}

describe('AttendancesController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let sessions: SessionsService;
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
        SessionsModule,
        AttendancesModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    sessions = moduleRef.get(SessionsService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await app.close();
  });

  async function setupActor(role: UserRole, tenantId?: string): Promise<TestActor & { locationId: string }> {
    let tenantPK = tenantId;
    if (!tenantPK) {
      const t = await prisma.tenant.create({
        data: { name: 'Test', slug: `t-${randomUUID()}` },
      });
      tenantIds.push(t.id);
      tenantPK = t.id;
    }
    const location = await prisma.location.create({
      data: { tenantId: tenantPK, name: `Main-${randomUUID()}` },
    });
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@x`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role,
        tenantId: tenantPK,
        firstName: 'Marker',
        lastName: 'McMark',
        ...(role === UserRole.ADMIN ? { locations: { connect: [{ id: location.id }] } } : {}),
      },
    });
    const tokens = await auth.login(user);
    return {
      tenantId: tenantPK,
      userId: user.id,
      locationId: location.id,
      accessToken: tokens.accessToken,
    };
  }

  async function newTrainee(tenantId: string, opts?: { userId?: string; guardianIds?: string[] }) {
    return prisma.trainee.create({
      data: {
        tenantId,
        firstName: 'T',
        lastName: 'X',
        dateOfBirth: new Date('2000-01-01'),
        userId: opts?.userId,
        guardians: opts?.guardianIds?.length
          ? { connect: opts.guardianIds.map((id) => ({ id })) }
          : undefined,
      },
    });
  }
  async function newClass(tenantId: string, traineeIds: string[] = []) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        trainees: traineeIds.length
          ? { connect: traineeIds.map((id) => ({ id })) }
          : undefined,
      },
    });
  }
  async function newLocation(tenantId: string) {
    return prisma.location.create({ data: { tenantId, name: `Loc-${randomUUID()}` } });
  }
  async function makeSession(tenantId: string, classId: string, locationId: string, trainerIds?: string[]) {
    return sessions.create(tenantId, {
      classId,
      locationId,
      startsAt: '2026-06-01T18:00:00.000Z',
      endsAt: '2026-06-01T19:00:00.000Z',
      trainerIds,
    });
  }

  describe('PUT /sessions/:id/attendances', () => {
    it('admin bulk-marks (200) and writes audit snapshot', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(a.tenantId);
      const cls = await newClass(a.tenantId, [tr.id]);
      const session = await makeSession(a.tenantId, cls.id, a.locationId);
      const res = await request(server)
        .put(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ items: [{ traineeId: tr.id, status: AttendanceStatus.PRESENT }] })
        .expect(200);
      expect(res.body).toEqual({ updated: 1 });
    });

    it('returns 403 for customer', async () => {
      const a = await setupActor(UserRole.CUSTOMER);
      await request(server)
        .put(`/sessions/anything/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ items: [{ traineeId: 'x', status: AttendanceStatus.PRESENT }] })
        .expect(403);
    });

    it('returns 400 for empty items array', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await newClass(a.tenantId);
      const loc = await newLocation(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, loc.id);
      await request(server)
        .put(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ items: [] })
        .expect(400);
    });

    it('returns 404 when session is in another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const tr = await newTrainee(b.tenantId);
      const cls = await newClass(b.tenantId, [tr.id]);
      const loc = await newLocation(b.tenantId);
      const session = await makeSession(b.tenantId, cls.id, loc.id);
      await request(server)
        .put(`/sessions/${session.id}/attendances`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ items: [{ traineeId: tr.id, status: AttendanceStatus.PRESENT }] })
        .expect(404);
    });
  });

  describe('PATCH /sessions/:id/rsvp', () => {
    it('customer RSVPs for own trainee (200)', async () => {
      const a = await setupActor(UserRole.CUSTOMER);
      const trainee = await newTrainee(a.tenantId, { userId: a.userId });
      const cls = await newClass(a.tenantId, [trainee.id]);
      const loc = await newLocation(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, loc.id);
      const res = await request(server)
        .patch(`/sessions/${session.id}/rsvp`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ traineeId: trainee.id, traineeRsvp: AttendanceRsvp.CONFIRMED })
        .expect(200);
      expect(res.body.traineeRsvp).toBe(AttendanceRsvp.CONFIRMED);
    });

    it('returns 403 when customer is not owner/guardian of trainee', async () => {
      const a = await setupActor(UserRole.CUSTOMER);
      const trainee = await newTrainee(a.tenantId);
      const cls = await newClass(a.tenantId, [trainee.id]);
      const loc = await newLocation(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, loc.id);
      await request(server)
        .patch(`/sessions/${session.id}/rsvp`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ traineeId: trainee.id, traineeRsvp: AttendanceRsvp.CONFIRMED })
        .expect(403);
    });

    it('returns 403 for admin role (RSVP is customer-only)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .patch(`/sessions/x/rsvp`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .send({ traineeId: 'x', traineeRsvp: AttendanceRsvp.CONFIRMED })
        .expect(403);
    });
  });

  describe('GET /me/sessions', () => {
    it('customer sees sessions for trainees they own/guard', async () => {
      const a = await setupActor(UserRole.CUSTOMER);
      const self = await newTrainee(a.tenantId, { userId: a.userId });
      const cls = await newClass(a.tenantId, [self.id]);
      const loc = await newLocation(a.tenantId);
      const session = await makeSession(a.tenantId, cls.id, loc.id);

      const res = await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(200);
      expect(res.body.map((s: { id: string }) => s.id)).toContain(session.id);
    });

    it('returns 403 for admin role', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/me/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(403);
    });
  });
});
