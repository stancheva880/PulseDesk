import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BillingMode, UserRole } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { PrismaService } from '@/prisma/prisma.service';
import { ClassesModule } from './classes.module';
import { createTestUser } from '@/test-utils/create-user';

const PASSWORD = 'TestPass123!';

interface TestActor {
  tenantId: string;
  locationId: string;
  userId: string;
  accessToken: string;
}

describe('ClassesController (e2e-ish)', () => {
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
        ClassesModule,
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

  async function setupActor(role: UserRole): Promise<TestActor> {
    const slug = `t-${randomUUID()}`;
    const tenant = await prisma.tenant.create({ data: { name: 'Test Tenant', slug } });
    tenantIds.push(tenant.id);
    const location = await prisma.location.create({
      data: { tenantId: tenant.id, name: `Main-${randomUUID()}` },
    });
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@test.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role,
      tenantId: tenant.id,
      ...(role === UserRole.ADMIN ? { locations: { connect: [{ id: location.id }] } } : {}),
    });
    const tokens = await auth.login(user);
    return {
      tenantId: tenant.id,
      locationId: location.id,
      userId: user.id,
      accessToken: tokens.accessToken,
    };
  }

  describe('POST /classes', () => {
    it('admin creates a PER_MONTH class', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          name: 'Beginner Tennis',
          billingMode: 'PER_MONTH',
          monthlyAmount: 80,
        })
        .expect(201);
      expect(res.body.name).toBe('Beginner Tennis');
      expect(res.body.tenantId).toBe(a.tenantId);
    });

    it('returns 400 when PER_MONTH is missing monthlyAmount', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ name: 'X', billingMode: 'PER_MONTH' })
        .expect(400);
    });

    // The same bounds the fee and payment amounts carry. A class price is copied straight into a
    // fee amount by the create-fee form, so a price the fee DTO would refuse must not be storable.
    it.each([0, -5, 1.234, 1_000_001])('rejects POST /classes with sessionPrice %s', async (
      sessionPrice,
    ) => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ name: 'X', billingMode: 'PER_SESSION', sessionPrice })
        .expect(400);
    });

    it.each([0.01, 0.5, 1_000_000])('accepts POST /classes with sessionPrice %s', async (
      sessionPrice,
    ) => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ name: `Cheap ${sessionPrice}`, billingMode: 'PER_SESSION', sessionPrice })
        .expect(201);
    });

    it('returns 400 when locationIds reference another tenant', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const inB = await prisma.location.create({
        data: { tenantId: b.tenantId, name: 'B-Loc' },
      });
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({
          name: 'X',
          billingMode: 'PER_SESSION',
          sessionPrice: 5,
          locationIds: [inB.id],
        })
        .expect(400);
    });

    it('returns 403 for employee', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      await request(server)
        .post('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ name: 'X', billingMode: 'PER_SESSION', sessionPrice: 10 })
        .expect(403);
    });
  });

  describe('GET /classes', () => {
    it('employee lists only classes they teach', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      // A class the employee teaches → visible.
      await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'Mine',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          trainers: { connect: [{ id: a.userId }] },
        },
      });
      // A class they don't teach (and have no session in) → hidden.
      await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'NotMine',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
        },
      });
      const res = await request(server)
        .get('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['Mine']);
    });

    // The classes table shows who's teaching each row without opening it.
    it('list rows carry their trainers', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const trainer = await createTestUser(prisma, {
        tenantId: a.tenantId, email: `${randomUUID()}@x`, passwordHash: 'x',
        role: UserRole.EMPLOYEE, firstName: 'Tina', lastName: 'Trainer',
      });
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'Yoga',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          trainers: { connect: { id: trainer.id } },
          locations: { connect: { id: a.locationId } },
        },
      });
      const untaught = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'Untaught',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: { id: a.locationId } },
        },
      });

      const res = await request(server)
        .get('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      const row = res.body.items.find((c: { id: string }) => c.id === cls.id);
      expect(row.trainers).toEqual([
        { id: trainer.id, firstName: 'Tina', lastName: 'Trainer', email: trainer.email },
      ]);
      const untaughtRow = res.body.items.find((c: { id: string }) => c.id === untaught.id);
      expect(untaughtRow.trainers).toEqual([]);
    });

    it('isolates classes across tenants', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'A',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      await prisma.class.create({
        data: {
          tenantId: b.tenantId,
          name: 'B',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: b.locationId }] },
        },
      });
      const res = await request(server)
        .get('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);
      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['A']);
    });
  });

  // TKT-0069: the dashboard counted active classes by paging every class in the tenant and
  // filtering in the browser. The filter belongs where the count is, and `total` is what the
  // dashboard reads — so both are asserted here, not just the rows.
  describe('GET /classes?isActive', () => {
    async function twoClasses(tenantId: string, locationId: string) {
      const base = {
        tenantId,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 5,
        locations: { connect: [{ id: locationId }] },
      };
      await prisma.class.create({ data: { ...base, name: 'Active' } });
      await prisma.class.create({ data: { ...base, name: 'Retired', isActive: false } });
    }

    it('counts only the active classes, without returning their rows', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await twoClasses(a.tenantId, a.locationId);

      const res = await request(server)
        .get('/classes?isActive=true&pageSize=1')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      // The point of the ticket: an exact count off the envelope, one row on the wire.
      expect(res.body.total).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Active');
    });

    it('filters the other way too', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await twoClasses(a.tenantId, a.locationId);

      const res = await request(server)
        .get('/classes?isActive=false')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['Retired']);
      expect(res.body.total).toBe(1);
    });

    it('omitting isActive returns both, so the parameter adds a filter and changes no default', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await twoClasses(a.tenantId, a.locationId);

      const res = await request(server)
        .get('/classes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.total).toBe(2);
    });

    // Boolean query params arrive as strings. Anything that is not 'true' or 'false' has to be a
    // 400: coercing it would answer with a filtered count the caller did not ask for.
    it('rejects a value that is not a boolean with 400', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .get('/classes?isActive=yes')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(400);
    });

    // TKT-0080: the trainee form's class picker searches instead of downloading every class.
    // Same contract as GET /users?search and GET /trainees?search, over the class name.
    describe('?search', () => {
      async function threeClasses(tenantId: string, locationId: string) {
        const base = {
          tenantId,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: locationId }] },
        };
        await prisma.class.create({ data: { ...base, name: 'Йога начинаещи' } });
        await prisma.class.create({ data: { ...base, name: 'Йога напреднали', isActive: false } });
        await prisma.class.create({ data: { ...base, name: 'Плуване' } });
      }

      async function names(actor: { tenantId: string; accessToken: string }, qs: string) {
        const res = await request(server)
          .get(`/classes?${qs}`)
          .set('Authorization', `Bearer ${actor.accessToken}`)
          .set('X-Tenant-Id', actor.tenantId)
          .expect(200);
        return (res.body.items as Array<{ name: string }>).map((c) => c.name);
      }

      it('matches a substring of the class name', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await threeClasses(a.tenantId, a.locationId);

        // Sorted on both sides: which classes match is the assertion, not where SQLite's
        // collation puts 'п' relative to 'ч'.
        expect((await names(a, 'search=Йога')).sort()).toEqual(
          ['Йога начинаещи', 'Йога напреднали'].sort(),
        );
        expect(await names(a, 'search=Плув')).toEqual(['Плуване']);
      });

      it('matches a Cyrillic name whatever case the query is typed in', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await threeClasses(a.tenantId, a.locationId);

        expect(await names(a, 'search=плуване')).toEqual(['Плуване']);
        expect(await names(a, 'search=ПЛУВАНЕ')).toEqual(['Плуване']);
      });

      // The two filters have to compose: the picker asks for active classes matching a query.
      it('composes with isActive rather than replacing it', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await threeClasses(a.tenantId, a.locationId);

        expect(await names(a, 'search=Йога&isActive=true')).toEqual(['Йога начинаещи']);
        expect(await names(a, 'search=Йога&isActive=false')).toEqual(['Йога напреднали']);
      });

      it('returns nothing for a query that matches no class', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await threeClasses(a.tenantId, a.locationId);
        expect(await names(a, 'search=Бокс')).toEqual([]);
      });

      it('rejects a search longer than 100 characters with 400', async () => {
        const a = await setupActor(UserRole.ADMIN);
        await request(server)
          .get(`/classes?search=${'a'.repeat(101)}`)
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .expect(400);
      });

      it('stays inside the trainer scope', async () => {
        const a = await setupActor(UserRole.EMPLOYEE);
        const base = { tenantId: a.tenantId, billingMode: BillingMode.PER_SESSION, sessionPrice: 5 };
        await prisma.class.create({
          data: { ...base, name: 'Йога моя', trainers: { connect: [{ id: a.userId }] } },
        });
        await prisma.class.create({ data: { ...base, name: 'Йога чужда' } });

        expect(await names(a, 'search=Йога')).toEqual(['Йога моя']);
      });
    });

    it('narrows within the trainer scope rather than escaping it', async () => {
      const a = await setupActor(UserRole.EMPLOYEE);
      const base = { tenantId: a.tenantId, billingMode: BillingMode.PER_SESSION, sessionPrice: 5 };
      // Active and taught by them → the only row they may count.
      await prisma.class.create({
        data: { ...base, name: 'MineActive', trainers: { connect: [{ id: a.userId }] } },
      });
      // Active but taught by nobody they know → must stay invisible even though isActive matches.
      await prisma.class.create({ data: { ...base, name: 'TheirsActive' } });

      const res = await request(server)
        .get('/classes?isActive=true')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.items.map((c: { name: string }) => c.name)).toEqual(['MineActive']);
      expect(res.body.total).toBe(1);
    });
  });

  describe('GET /classes/:id', () => {
    it('returns the contract-checked detail shape', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'Detail',
          billingMode: 'PER_MONTH',
          monthlyAmount: 80,
          locations: { connect: [{ id: a.locationId }] },
          trainers: { connect: [{ id: a.userId }] },
        },
      });
      const res = await request(server)
        .get(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(200);

      expect(res.body.name).toBe('Detail');
      expect(res.body.monthlyAmount).toBe('80');
      // GET /classes/:id selects only { id, name } from locations — the contract is those
      // two columns, so the whole point is that both are present and nothing more is.
      expect(res.body.locations).toEqual([{ id: a.locationId, name: expect.any(String) }]);
      expect(Object.keys(res.body.locations[0]).sort()).toEqual(['id', 'name']);
      expect(Object.keys(res.body.trainers[0]).sort()).toEqual([
        'email',
        'firstName',
        'id',
        'lastName',
      ]);
      expect(res.body.trainees).toEqual([]);
    });
  });

  describe('PATCH /classes/:id', () => {
    // 'rejects billingMode change' replaced under an approved TEST CHANGE REQUEST
    // (TKT-0109, 2026-08-22): PRD-0015 AC #4 supersedes the PRD-0003 immutability rule.
    // The switch is validated instead of forbidden — each rule pinned below.
    describe('billingMode switch (TKT-0109)', () => {
      async function monthlyClass(a: { tenantId: string; locationId: string }) {
        return prisma.class.create({
          data: {
            tenantId: a.tenantId,
            name: `Switch-${randomUUID()}`,
            billingMode: BillingMode.PER_MONTH,
            monthlyAmount: 100,
            locations: { connect: [{ id: a.locationId }] },
          },
        });
      }
      const patch = (
        a: { tenantId: string; accessToken: string },
        id: string,
        body: object,
      ) =>
        request(server)
          .patch(`/classes/${id}`)
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .send(body);

      it('switches PER_MONTH → PER_COURSE, clearing monthlyAmount; existing fees untouched', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const cls = await monthlyClass(a);
        const tr = await prisma.trainee.create({
          data: { tenantId: a.tenantId, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
        });
        const fee = await prisma.fee.create({
          data: {
            tenantId: a.tenantId,
            classId: cls.id,
            traineeId: tr.id,
            periodStart: new Date('2026-03-01'),
            periodEnd: new Date('2026-03-31'),
            amount: 100,
          },
        });

        const res = await patch(a, cls.id, {
          billingMode: 'PER_COURSE',
          courseStart: '2026-03-01',
          courseEnd: '2026-08-31',
          coursePrice: 300,
        }).expect(200);
        expect(res.body.billingMode).toBe('PER_COURSE');
        expect(res.body.monthlyAmount).toBeNull();
        expect(res.body.coursePrice).toBe('300');

        // AC #4: the switch never reads or writes fees — the row is byte-identical.
        const feeAfter = await prisma.fee.findUnique({ where: { id: fee.id } });
        expect(feeAfter).toEqual(fee);
      });

      it('rejects the switch without the course fields (CLASS_COURSE_FIELDS_REQUIRED)', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const cls = await monthlyClass(a);
        const res = await patch(a, cls.id, { billingMode: 'PER_COURSE' }).expect(400);
        expect(res.body.code).toBe('CLASS_COURSE_FIELDS_REQUIRED');
        const unchanged = await prisma.class.findUnique({ where: { id: cls.id } });
        expect(unchanged?.billingMode).toBe(BillingMode.PER_MONTH);
      });

      it('switches PER_COURSE → PER_MONTH, clearing the course fields', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const cls = await prisma.class.create({
          data: {
            tenantId: a.tenantId,
            name: `Course-${randomUUID()}`,
            billingMode: BillingMode.PER_COURSE,
            courseStart: new Date('2026-03-01'),
            courseEnd: new Date('2026-08-31'),
            coursePrice: 300,
            locations: { connect: [{ id: a.locationId }] },
          },
        });
        const res = await patch(a, cls.id, {
          billingMode: 'PER_MONTH',
          monthlyAmount: 90,
        }).expect(200);
        expect(res.body.billingMode).toBe('PER_MONTH');
        expect(res.body.monthlyAmount).toBe('90');
        expect(res.body.courseStart).toBeNull();
        expect(res.body.courseEnd).toBeNull();
        expect(res.body.coursePrice).toBeNull();
      });

      it('still rejects wrong-mode price fields without a switch', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const cls = await prisma.class.create({
          data: {
            tenantId: a.tenantId,
            name: `Course-${randomUUID()}`,
            billingMode: BillingMode.PER_COURSE,
            courseStart: new Date('2026-03-01'),
            courseEnd: new Date('2026-08-31'),
            coursePrice: 300,
            locations: { connect: [{ id: a.locationId }] },
          },
        });
        await patch(a, cls.id, { sessionPrice: 10 }).expect(400);
        await patch(a, cls.id, { monthlyAmount: 100 }).expect(400);
      });

      // TKT-0110: course fees ride roster changes — one fee per enrolled trainee.
      describe('course fees on roster change (TKT-0110)', () => {
        const START = new Date('2026-12-01');
        const END = new Date('2027-05-31');
        async function courseClass(
          a: { tenantId: string; locationId: string },
          courseStart: Date = START,
        ) {
          return prisma.class.create({
            data: {
              tenantId: a.tenantId,
              name: `CF-${randomUUID()}`,
              billingMode: BillingMode.PER_COURSE,
              courseStart,
              courseEnd: END,
              coursePrice: 300,
              locations: { connect: [{ id: a.locationId }] },
            },
          });
        }
        async function newTrainee(tenantId: string) {
          return prisma.trainee.create({
            data: { tenantId, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
          });
        }

        it('adding a trainee creates the course fee; re-sending the roster is idempotent', async () => {
          const a = await setupActor(UserRole.ADMIN);
          const cls = await courseClass(a);
          const tr = await newTrainee(a.tenantId);

          await patch(a, cls.id, { traineeIds: [tr.id] }).expect(200);
          const fee = await prisma.fee.findFirst({ where: { classId: cls.id, traineeId: tr.id } });
          expect(Number(fee?.amount)).toBe(300);
          expect(fee?.periodStart.toISOString()).toBe(START.toISOString());
          expect(fee?.periodEnd.toISOString()).toBe(END.toISOString());

          await patch(a, cls.id, { traineeIds: [tr.id] }).expect(200);
          expect(await prisma.fee.count({ where: { classId: cls.id, traineeId: tr.id } })).toBe(1);
        });

        it('POST /classes with an initial roster creates the fees', async () => {
          const a = await setupActor(UserRole.ADMIN);
          const tr = await newTrainee(a.tenantId);
          const res = await request(server)
            .post('/classes')
            .set('Authorization', `Bearer ${a.accessToken}`)
            .set('X-Tenant-Id', a.tenantId)
            .send({
              name: `CF-${randomUUID()}`,
              billingMode: 'PER_COURSE',
              courseStart: '2026-12-01',
              courseEnd: '2027-05-31',
              coursePrice: 300,
              traineeIds: [tr.id],
              locationIds: [a.locationId],
            })
            .expect(201);
          const fee = await prisma.fee.findFirst({
            where: { classId: res.body.id, traineeId: tr.id },
          });
          expect(Number(fee?.amount)).toBe(300);
        });

        it('unenrolling before courseStart deletes the untouched fee', async () => {
          const a = await setupActor(UserRole.ADMIN);
          const cls = await courseClass(a); // starts 2026-12-01, "now" is before that
          const tr = await newTrainee(a.tenantId);
          await patch(a, cls.id, { traineeIds: [tr.id] }).expect(200);
          await patch(a, cls.id, { traineeIds: [] }).expect(200);
          expect(await prisma.fee.count({ where: { classId: cls.id, traineeId: tr.id } })).toBe(0);
        });

        it('unenrolling keeps a fee that has a payment', async () => {
          const a = await setupActor(UserRole.ADMIN);
          const cls = await courseClass(a);
          const tr = await newTrainee(a.tenantId);
          await patch(a, cls.id, { traineeIds: [tr.id] }).expect(200);
          const fee = await prisma.fee.findFirstOrThrow({
            where: { classId: cls.id, traineeId: tr.id },
          });
          await prisma.payment.create({
            data: { tenantId: a.tenantId, feeId: fee.id, amount: 100, paidAt: new Date() },
          });

          await patch(a, cls.id, { traineeIds: [] }).expect(200);
          expect(await prisma.fee.count({ where: { id: fee.id } })).toBe(1);
        });

        it('unenrolling after courseStart keeps the fee', async () => {
          const a = await setupActor(UserRole.ADMIN);
          const cls = await courseClass(a, new Date('2026-01-01')); // already started
          const tr = await newTrainee(a.tenantId);
          await patch(a, cls.id, { traineeIds: [tr.id] }).expect(200);
          await patch(a, cls.id, { traineeIds: [] }).expect(200);
          expect(await prisma.fee.count({ where: { classId: cls.id, traineeId: tr.id } })).toBe(1);
        });
      });

      it('rejects editing course dates into a bad order on an existing course class', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const cls = await prisma.class.create({
          data: {
            tenantId: a.tenantId,
            name: `Course-${randomUUID()}`,
            billingMode: BillingMode.PER_COURSE,
            courseStart: new Date('2026-03-01'),
            courseEnd: new Date('2026-08-31'),
            coursePrice: 300,
            locations: { connect: [{ id: a.locationId }] },
          },
        });
        const res = await patch(a, cls.id, { courseStart: '2026-09-01' }).expect(400);
        expect(res.body.code).toBe('CLASS_COURSE_PERIOD_ORDER');
      });
    });

    it.each([0, -5, 1.234, 1_000_001])('rejects PATCH /classes/:id with monthlyAmount %s', async (
      monthlyAmount,
    ) => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'X',
          billingMode: BillingMode.PER_MONTH,
          monthlyAmount: 100,
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      await request(server)
        .patch(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ monthlyAmount })
        .expect(400);
    });

    it('returns 404 for cross-tenant update', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const b = await setupActor(UserRole.ADMIN);
      const inA = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'X',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
        },
      });
      await request(server)
        .patch(`/classes/${inA.id}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Tenant-Id', b.tenantId)
        .send({ name: 'Hijack' })
        .expect(404);
    });
  });

  // TKT-0123: an ADMIN sees a class when ANY of its locations is theirs, and `set` replaces the
  // whole relation — so a single-hall admin could strip a shared class of the other hall, its
  // trainers and its roster. Validating the incoming ids never caught it: what leaves is the
  // problem, not what arrives.
  describe('PATCH /classes/:id — the other hall', () => {
    async function sharedClass(a: TestActor) {
      const other = await prisma.location.create({
        data: { tenantId: a.tenantId, name: `Other-${randomUUID()}` },
      });
      const outsider = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'Out',
          lastName: randomUUID().slice(0, 8),
          dateOfBirth: new Date('2000-01-01'),
          locations: { connect: [{ id: other.id }] },
        },
      });
      const mine = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'Mine',
          lastName: randomUUID().slice(0, 8),
          dateOfBirth: new Date('2000-01-01'),
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: `Shared-${randomUUID()}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 10,
          locations: { connect: [{ id: a.locationId }, { id: other.id }] },
          trainees: { connect: [{ id: outsider.id }, { id: mine.id }] },
        },
      });
      return { cls, other, outsider, mine };
    }

    it('refuses to detach a location the admin does not hold → 403', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { cls, other } = await sharedClass(a);

      await request(server)
        .patch(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ locationIds: [a.locationId] })
        .expect(403);

      const after = await prisma.class.findUniqueOrThrow({
        where: { id: cls.id },
        select: { locations: { select: { id: true } } },
      });
      expect(after.locations.map((l) => l.id).sort()).toEqual([a.locationId, other.id].sort());
    });

    it('refuses to unenrol a trainee from outside the admin’s locations → 403', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { cls, outsider, mine } = await sharedClass(a);

      await request(server)
        .patch(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeIds: [mine.id] })
        .expect(403);

      const after = await prisma.class.findUniqueOrThrow({
        where: { id: cls.id },
        select: { trainees: { select: { id: true } } },
      });
      expect(after.trainees.map((t) => t.id).sort()).toEqual([mine.id, outsider.id].sort());
    });

    it('still lets the admin unenrol a trainee of their own location → 200', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { cls, outsider, mine } = await sharedClass(a);

      await request(server)
        .patch(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeIds: [outsider.id] })
        .expect(200);

      const after = await prisma.class.findUniqueOrThrow({
        where: { id: cls.id },
        select: { trainees: { select: { id: true } } },
      });
      expect(after.trainees.map((t) => t.id)).toEqual([outsider.id]);
      expect(after.trainees.map((t) => t.id)).not.toContain(mine.id);
    });

    // TKT-0123: the enrolment backfill follows the same active-only rule as session creation.
    it('enrolling an inactive trainee books them into nothing', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const archived = await prisma.trainee.create({
        data: {
          tenantId: a.tenantId,
          firstName: 'Gone',
          lastName: randomUUID().slice(0, 8),
          dateOfBirth: new Date('2000-01-01'),
          isActive: false,
        },
      });
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: `Backfill-${randomUUID()}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 10,
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      const session = await prisma.session.create({
        data: {
          tenantId: a.tenantId,
          classId: cls.id,
          locationId: a.locationId,
          startsAt: new Date('2030-01-01T10:00:00Z'),
          endsAt: new Date('2030-01-01T11:00:00Z'),
        },
      });

      await request(server)
        .patch(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ traineeIds: [archived.id] })
        .expect(200);

      expect(await prisma.attendance.count({ where: { sessionId: session.id } })).toBe(0);
    });

    it('a SUPER_ADMIN is unrestricted → 200', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const { cls } = await sharedClass(a);
      const sa = await setupActor(UserRole.SUPER_ADMIN);

      await request(server)
        .patch(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${sa.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .send({ locationIds: [a.locationId] })
        .expect(200);
    });
  });

  describe('DELETE /classes/:id', () => {
    it('admin deletes (204)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'X',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      await request(server)
        .delete(`/classes/${cls.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Tenant-Id', a.tenantId)
        .expect(204);
    });

    // TKT-0123: Fee.class cascades, and Payment.fee / Refund.fee cascade from there, so this
    // delete used to erase the class's whole money history without a word.
    describe('the money guard', () => {
      async function classWithFee(a: { tenantId: string; locationId: string }) {
        const cls = await prisma.class.create({
          data: {
            tenantId: a.tenantId,
            name: `Ledger-${randomUUID()}`,
            billingMode: BillingMode.PER_SESSION,
            sessionPrice: 20,
            locations: { connect: [{ id: a.locationId }] },
          },
        });
        const trainee = await prisma.trainee.create({
          data: {
            tenantId: a.tenantId,
            firstName: 'L',
            lastName: randomUUID().slice(0, 8),
            dateOfBirth: new Date('2000-01-01'),
          },
        });
        const fee = await prisma.fee.create({
          data: {
            tenantId: a.tenantId,
            classId: cls.id,
            traineeId: trainee.id,
            periodStart: new Date('2026-05-01T00:00:00Z'),
            periodEnd: new Date('2026-05-31T00:00:00Z'),
            amount: 20,
          },
        });
        return { cls, fee };
      }

      it('refuses when a fee on the class carries a payment → 409', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const { cls, fee } = await classWithFee(a);
        const payment = await prisma.payment.create({
          data: { tenantId: a.tenantId, feeId: fee.id, amount: 20, paidAt: new Date() },
        });

        const res = await request(server)
          .delete(`/classes/${cls.id}`)
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .expect(409);
        expect(res.body.code).toBe('CLASS_HAS_PAYMENTS');

        // The whole chain survives — that is the point of the guard.
        expect(await prisma.class.count({ where: { id: cls.id } })).toBe(1);
        expect(await prisma.fee.count({ where: { id: fee.id } })).toBe(1);
        expect(await prisma.payment.count({ where: { id: payment.id } })).toBe(1);
      });

      it('refuses when a fee on the class carries a refund → 409', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const { cls, fee } = await classWithFee(a);
        await prisma.payment.create({
          data: { tenantId: a.tenantId, feeId: fee.id, amount: 20, paidAt: new Date() },
        });
        await prisma.refund.create({
          data: { tenantId: a.tenantId, feeId: fee.id, amount: 5, refundedAt: new Date() },
        });

        const res = await request(server)
          .delete(`/classes/${cls.id}`)
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .expect(409);
        expect(res.body.code).toBe('CLASS_HAS_PAYMENTS');
      });

      // An unpaid fee is a billing intention the generators can rebuild, so it does not block.
      it('still deletes a class whose fees are all unpaid → 204', async () => {
        const a = await setupActor(UserRole.ADMIN);
        const { cls, fee } = await classWithFee(a);

        await request(server)
          .delete(`/classes/${cls.id}`)
          .set('Authorization', `Bearer ${a.accessToken}`)
          .set('X-Tenant-Id', a.tenantId)
          .expect(204);
        expect(await prisma.fee.count({ where: { id: fee.id } })).toBe(0);
      });
    });
  });
  describe('capacity (TKT-0103)', () => {
    const mkTrainee = (tenantId: string) =>
      prisma.trainee.create({
        data: {
          tenantId,
          firstName: 'T',
          lastName: randomUUID().slice(0, 8),
          dateOfBirth: new Date('2000-01-01'),
        },
      });
    const send = (a: TestActor) => ({
      Authorization: `Bearer ${a.accessToken}`,
      'X-Tenant-Id': a.tenantId,
    });

    it('persists capacity on create', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .post('/classes')
        .set(send(a))
        .send({ name: 'Capped', billingMode: 'PER_SESSION', sessionPrice: 5, capacity: 8 })
        .expect(201);
      expect(res.body.capacity).toBe(8);
    });

    it('rejects capacity 0 with 400', async () => {
      const a = await setupActor(UserRole.ADMIN);
      await request(server)
        .post('/classes')
        .set(send(a))
        .send({ name: 'Zero', billingMode: 'PER_SESSION', sessionPrice: 5, capacity: 0 })
        .expect(400);
    });

    // Approved TEST CHANGE REQUEST, 2026-08-22: TKT-0111 (warn-allow, user decision) replaces
    // TKT-0103's class-level hard gate — the three 400 pins below now pin that the same
    // writes succeed and persist. The session-level ATTENDANCE_SESSION_FULL gate is untouched.
    it('allows enrolling more trainees than capacity on create (warn-allow, TKT-0111)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const t1 = await mkTrainee(a.tenantId);
      const t2 = await mkTrainee(a.tenantId);
      const res = await request(server)
        .post('/classes')
        .set(send(a))
        .send({
          name: 'Overfull',
          billingMode: 'PER_SESSION',
          sessionPrice: 5,
          capacity: 1,
          traineeIds: [t1.id, t2.id],
        })
        .expect(201);
      const stored = await prisma.class.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { trainees: true },
      });
      expect(stored.trainees).toHaveLength(2);
      expect(stored.capacity).toBe(1);
    });

    it('allows capacity below the current enrollment (warn-allow, TKT-0111)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const t1 = await mkTrainee(a.tenantId);
      const t2 = await mkTrainee(a.tenantId);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'Shrink',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: a.locationId }] },
          trainees: { connect: [{ id: t1.id }, { id: t2.id }] },
        },
      });
      await request(server)
        .patch(`/classes/${cls.id}`)
        .set(send(a))
        .send({ capacity: 1 })
        .expect(200);
      const stored = await prisma.class.findUniqueOrThrow({ where: { id: cls.id } });
      expect(stored.capacity).toBe(1);
    });

    it('allows enrolling over an existing capacity on update (warn-allow, TKT-0111)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const t1 = await mkTrainee(a.tenantId);
      const t2 = await mkTrainee(a.tenantId);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'Grow',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: a.locationId }] },
          capacity: 1,
        },
      });
      await request(server)
        .patch(`/classes/${cls.id}`)
        .set(send(a))
        .send({ traineeIds: [t1.id, t2.id] })
        .expect(200);
      const stored = await prisma.class.findUniqueOrThrow({
        where: { id: cls.id },
        include: { trainees: true },
      });
      expect(stored.trainees).toHaveLength(2);
    });

    it('persists waitlistMode on create and defaults to NONE (TKT-0112)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const withMode = await request(server)
        .post('/classes')
        .set(send(a))
        .send({ name: 'Queued', billingMode: 'PER_SESSION', sessionPrice: 5, waitlistMode: 'FIFO_AUTO' })
        .expect(201);
      expect(withMode.body.waitlistMode).toBe('FIFO_AUTO');

      const bare = await request(server)
        .post('/classes')
        .set(send(a))
        .send({ name: 'Unqueued', billingMode: 'PER_SESSION', sessionPrice: 5 })
        .expect(201);
      expect(bare.body.waitlistMode).toBe('NONE');
    });

    it('switches waitlistMode on update (TKT-0112)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'SwitchQueue',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: a.locationId }] },
        },
      });
      const res = await request(server)
        .patch(`/classes/${cls.id}`)
        .set(send(a))
        .send({ waitlistMode: 'CLAIM' })
        .expect(200);
      expect(res.body.waitlistMode).toBe('CLAIM');
    });

    it('clears capacity with null on update', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: 'Uncap',
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          locations: { connect: [{ id: a.locationId }] },
          capacity: 3,
        },
      });
      const res = await request(server)
        .patch(`/classes/${cls.id}`)
        .set(send(a))
        .send({ capacity: null })
        .expect(200);
      expect(res.body.capacity).toBeNull();
    });
  });

  describe('self-booking flag (TKT-0117)', () => {
    const send = (a: TestActor) => ({
      Authorization: `Bearer ${a.accessToken}`,
      'X-Tenant-Id': a.tenantId,
    });
    const mkClass = (a: TestActor, extra: Record<string, unknown> = {}) =>
      prisma.class.create({
        data: {
          tenantId: a.tenantId,
          name: `SB-${randomUUID().slice(0, 8)}`,
          billingMode: BillingMode.PER_SESSION,
          sessionPrice: 5,
          // The admin actor is location-scoped — an unattached class would 404 on PATCH.
          locations: { connect: [{ id: a.locationId }] },
          ...extra,
        },
      });

    it('persists the flag and the cutoff on create, and the row response carries both', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .post('/classes')
        .set(send(a))
        .send({
          name: 'Bookable',
          billingMode: 'PER_SESSION',
          sessionPrice: 5,
          allowSelfBooking: true,
          bookingCutoffMin: 60,
        })
        .expect(201);
      expect(res.body.allowSelfBooking).toBe(true);
      expect(res.body.bookingCutoffMin).toBe(60);
    });

    it('defaults to off with no cutoff', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .post('/classes')
        .set(send(a))
        .send({ name: 'Plain', billingMode: 'PER_SESSION', sessionPrice: 5 })
        .expect(201);
      expect(res.body.allowSelfBooking).toBe(false);
      expect(res.body.bookingCutoffMin).toBeNull();
    });

    it('rejects a cutoff without the flag on create (400)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const res = await request(server)
        .post('/classes')
        .set(send(a))
        .send({ name: 'NoFlag', billingMode: 'PER_SESSION', sessionPrice: 5, bookingCutoffMin: 60 })
        .expect(400);
      expect(res.body.code).toBe('CLASS_CUTOFF_REQUIRES_SELF_BOOKING');
    });

    it('rejects a negative or fractional cutoff (400)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      for (const bookingCutoffMin of [-1, 1.5]) {
        await request(server)
          .post('/classes')
          .set(send(a))
          .send({
            name: `Bad-${bookingCutoffMin}`,
            billingMode: 'PER_SESSION',
            sessionPrice: 5,
            allowSelfBooking: true,
            bookingCutoffMin,
          })
          .expect(400);
      }
    });

    it('turning the flag off clears the cutoff', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await mkClass(a, { allowSelfBooking: true, bookingCutoffMin: 30 });
      const res = await request(server)
        .patch(`/classes/${cls.id}`)
        .set(send(a))
        .send({ allowSelfBooking: false })
        .expect(200);
      expect(res.body.allowSelfBooking).toBe(false);
      expect(res.body.bookingCutoffMin).toBeNull();
    });

    it('rejects a cutoff edit while the stored flag is off (400)', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await mkClass(a);
      const res = await request(server)
        .patch(`/classes/${cls.id}`)
        .set(send(a))
        .send({ bookingCutoffMin: 45 })
        .expect(400);
      expect(res.body.code).toBe('CLASS_CUTOFF_REQUIRES_SELF_BOOKING');
    });

    it('null clears the cutoff while the flag stays on', async () => {
      const a = await setupActor(UserRole.ADMIN);
      const cls = await mkClass(a, { allowSelfBooking: true, bookingCutoffMin: 30 });
      const res = await request(server)
        .patch(`/classes/${cls.id}`)
        .set(send(a))
        .send({ bookingCutoffMin: null })
        .expect(200);
      expect(res.body.allowSelfBooking).toBe(true);
      expect(res.body.bookingCutoffMin).toBeNull();
    });
  });
});
