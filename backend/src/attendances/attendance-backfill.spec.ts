import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AttendanceStatus, BillingMode, SessionStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { backfillFutureSessions } from './attendance-backfill';

describe('backfillFutureSessions', () => {
  let prisma: PrismaService;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.onModuleDestroy();
  });

  const NOW = new Date('2026-06-27T00:00:00.000Z');
  const FUTURE = new Date('2026-07-01T18:00:00.000Z');
  const PAST = new Date('2026-06-01T18:00:00.000Z');
  const plusHour = (d: Date) => new Date(d.getTime() + 3_600_000);

  async function setup() {
    const tenant = await prisma.tenant.create({ data: { name: 'T', slug: `t-${randomUUID()}` } });
    tenantIds.push(tenant.id);
    const location = await prisma.location.create({
      data: { tenantId: tenant.id, name: `L-${randomUUID()}` },
    });
    const cls = await prisma.class.create({
      data: {
        tenantId: tenant.id,
        name: `C-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
      },
    });
    const trainee = await prisma.trainee.create({
      data: { tenantId: tenant.id, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
    });
    return { tenant, location, cls, trainee };
  }

  function makeSession(
    tenantId: string,
    classId: string,
    locationId: string,
    startsAt: Date,
    status: SessionStatus = SessionStatus.SCHEDULED,
  ) {
    return prisma.session.create({
      data: { tenantId, classId, locationId, startsAt, endsAt: plusHour(startsAt), status },
    });
  }

  it('creates a PENDING row for a future SCHEDULED session', async () => {
    const { tenant, location, cls, trainee } = await setup();
    const session = await makeSession(tenant.id, cls.id, location.id, FUTURE);

    await prisma.$transaction((tx) =>
      backfillFutureSessions(tx, { tenantId: tenant.id, classId: cls.id, traineeIds: [trainee.id], now: NOW }),
    );

    const rows = await prisma.attendance.findMany({
      where: { sessionId: session.id, traineeId: trainee.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe(AttendanceStatus.PENDING);
  });

  it('does NOT touch past or non-SCHEDULED sessions', async () => {
    const { tenant, location, cls, trainee } = await setup();
    const pastScheduled = await makeSession(tenant.id, cls.id, location.id, PAST);
    const futureCompleted = await makeSession(tenant.id, cls.id, location.id, FUTURE, SessionStatus.COMPLETED);

    await prisma.$transaction((tx) =>
      backfillFutureSessions(tx, { tenantId: tenant.id, classId: cls.id, traineeIds: [trainee.id], now: NOW }),
    );

    const count = await prisma.attendance.count({
      where: { traineeId: trainee.id, sessionId: { in: [pastScheduled.id, futureCompleted.id] } },
    });
    expect(count).toBe(0);
  });

  it('is idempotent — re-running creates no duplicate rows', async () => {
    const { tenant, location, cls, trainee } = await setup();
    const session = await makeSession(tenant.id, cls.id, location.id, FUTURE);

    const run = () =>
      prisma.$transaction((tx) =>
        backfillFutureSessions(tx, { tenantId: tenant.id, classId: cls.id, traineeIds: [trainee.id], now: NOW }),
      );
    await run();
    await run();

    const rows = await prisma.attendance.findMany({
      where: { sessionId: session.id, traineeId: trainee.id },
    });
    expect(rows).toHaveLength(1);
  });
});
