import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { seedData, slugifyTenantName } from './seed-data';

// The stub-client tests in seed-data.spec.ts prove which writes are attempted; they cannot
// prove Prisma accepts them. A misspelled field, a wrong enum or a bad nested create only
// fails against a real client, so exactly one run goes to the real SQLite database.
//
// The tenant name carries a unique suffix, and afterAll removes the tenant (which cascades
// to all ten scoped tables) plus the generated users, which carry no tenantId and are
// therefore not cascaded.

const RUN_ID = `${Date.now().toString(36)}`;
const TENANT_NAME = `Seed Data Spec ${RUN_ID}`;
const TENANT_SLUG = slugifyTenantName(TENANT_NAME);

const prisma = new PrismaClient();
let tenantId: string;

beforeAll(async () => {
  process.env.SEED_DATA_PASSWORD = 'a-real-seed-data-password';
  delete process.env.NODE_ENV;
  await seedData(prisma, { createTenant: TENANT_NAME, size: 'small' });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });
  tenantId = tenant.id;
}, 60_000);

afterAll(async () => {
  try {
    // By slug, not the captured id: if beforeAll throws part-way the tenant may exist
    // while `tenantId` was never assigned, and the row would survive the run.
    await prisma.tenant.deleteMany({ where: { slug: TENANT_SLUG } });
    await prisma.user.deleteMany({
      where: { email: { endsWith: `@${TENANT_SLUG}.pulsedesk.local` } },
    });
  } finally {
    await prisma.$disconnect();
  }
});

describe('seedData against real SQLite', () => {
  it('writes a populated tenant', async () => {
    const scoped = { where: { tenantId } };
    expect(await prisma.location.count(scoped)).toBe(1);
    expect(await prisma.class.count(scoped)).toBe(2);
    expect(await prisma.trainee.count(scoped)).toBe(8);
    expect(await prisma.classSchedule.count(scoped)).toBe(4);
    expect(await prisma.session.count(scoped)).toBe(24);
    expect(await prisma.attendance.count(scoped)).toBe(96);
    expect(await prisma.fee.count(scoped)).toBeGreaterThan(0);
    // 1 admin + 1 trainer + 2 customers.
    expect(await prisma.membership.count(scoped)).toBe(4);
  });

  it('keeps every fee ledger at or below its amount, with a matching status', async () => {
    const fees = await prisma.fee.findMany({ where: { tenantId }, include: { payments: true } });
    expect(fees.length).toBeGreaterThan(0);
    for (const fee of fees) {
      const paid = fee.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const amount = Number(fee.amount);
      expect(paid).toBeLessThanOrEqual(amount);
      if (fee.status === 'PAID') expect(paid).toBe(amount);
      else if (fee.status === 'PARTIAL') expect(paid).toBeGreaterThan(0);
      else expect(paid).toBe(0);
    }
  });

  it('gives every minor a contact person, as POST /api/trainees would demand', async () => {
    const trainees = await prisma.trainee.findMany({
      where: { tenantId },
      include: { contacts: true },
    });
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

    const minors = trainees.filter((trainee) => trainee.dateOfBirth > eighteenYearsAgo);
    expect(minors.length).toBeGreaterThan(0);
    for (const minor of minors) {
      expect(minor.contacts.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('assigns staff to a location, so location-scoped reads are not empty', async () => {
    const staff = await prisma.user.findMany({
      where: { memberships: { some: { tenantId, role: { in: ['ADMIN', 'EMPLOYEE'] } } } },
      include: { locations: true },
    });
    expect(staff.length).toBe(2);
    for (const member of staff) {
      expect(member.locations.length).toBeGreaterThan(0);
    }
  });

  it('appends a second batch to the same tenant without duplicating sessions', async () => {
    const before = {
      trainees: await prisma.trainee.count({ where: { tenantId } }),
      sessions: await prisma.session.count({ where: { tenantId } }),
      schedules: await prisma.classSchedule.count({ where: { tenantId } }),
    };

    await seedData(prisma, { fill: TENANT_SLUG, size: 'small' });

    expect(await prisma.trainee.count({ where: { tenantId } })).toBe(before.trainees + 8);
    // Classes, schedules and sessions are reused — only the people and their fees grow.
    expect(await prisma.session.count({ where: { tenantId } })).toBe(before.sessions);
    expect(await prisma.classSchedule.count({ where: { tenantId } })).toBe(before.schedules);
  }, 60_000);

  it('refuses a second --create-tenant on the same slug', async () => {
    await expect(seedData(prisma, { createTenant: TENANT_NAME, size: 'small' })).rejects.toThrow(
      /--fill/,
    );
  });
});
