import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { parseSeedDataArgs, seedData, type SeedDataOptions } from './seed-data';

// Companion to seed.spec.ts. Same rules: no database, the client is a parameter, so a stub
// observes exactly which writes are attempted. seed-data.ts is side-effect-free on import
// for the same reason seed.ts is.

const STRONG_PASSWORD = 'a-real-seed-data-password';
const TENANT_ID = 'tenant-1';
const TENANT_SLUG = 'iron-gym';

/** Throws on ANY property access, so reaching the database at all fails the test. */
function prismaThatMustNotBeTouched(): PrismaClient {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `seedData() touched the database (prisma.${String(prop)}) before validating`,
        );
      },
    },
  ) as PrismaClient;
}

interface CreateArgs {
  data: Record<string, unknown>;
}

function recordingPrisma(existingTenant: unknown = null) {
  let n = 0;
  const id = (prefix: string) => `${prefix}-${(n += 1)}`;
  return {
    tenant: {
      findUnique: vi.fn().mockResolvedValue(existingTenant),
      create: vi
        .fn()
        .mockImplementation(async ({ data }: CreateArgs) => ({ id: TENANT_ID, ...data })),
    },
    user: {
      create: vi.fn().mockImplementation(async ({ data }: CreateArgs) => ({
        id: id('user'),
        email: data.email,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
      })),
    },
    location: {
      upsert: vi.fn().mockImplementation(async () => ({ id: id('location') })),
    },
    class: {
      upsert: vi.fn().mockImplementation(async () => ({ id: id('class') })),
    },
    trainee: {
      create: vi.fn().mockImplementation(async () => ({ id: id('trainee') })),
    },
    classSchedule: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async () => ({ id: id('schedule') })),
    },
    session: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async () => ({ id: id('session') })),
    },
    attendance: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    fee: {
      create: vi.fn().mockImplementation(async () => ({ id: id('fee') })),
    },
  };
}

type Recording = ReturnType<typeof recordingPrisma>;

const asClient = (stub: Recording): PrismaClient => stub as unknown as PrismaClient;

const createSmall: SeedDataOptions = { createTenant: 'Iron Gym', size: 'small' };

/** Every `data` (or `create`) payload the stub recorded, across every scoped model. */
function allWrittenData(stub: Recording): Record<string, unknown>[] {
  const written: Record<string, unknown>[] = [];
  const push = (fn: { mock: { calls: unknown[][] } }) => {
    for (const [args] of fn.mock.calls) {
      const payload = args as { data?: unknown; create?: unknown };
      const data = payload.data ?? payload.create;
      if (Array.isArray(data)) written.push(...(data as Record<string, unknown>[]));
      else if (data) written.push(data as Record<string, unknown>);
    }
  };
  push(stub.location.upsert);
  push(stub.class.upsert);
  push(stub.trainee.create);
  push(stub.classSchedule.create);
  push(stub.session.create);
  push(stub.attendance.createMany);
  push(stub.fee.create);
  return written;
}

function writeCallCount(stub: Recording): number {
  return (
    stub.tenant.create.mock.calls.length +
    stub.user.create.mock.calls.length +
    stub.location.upsert.mock.calls.length +
    stub.class.upsert.mock.calls.length +
    stub.trainee.create.mock.calls.length +
    stub.classSchedule.create.mock.calls.length +
    stub.session.create.mock.calls.length +
    stub.attendance.createMany.mock.calls.length +
    stub.fee.create.mock.calls.length
  );
}

describe('parseSeedDataArgs', () => {
  it('accepts --create-tenant and defaults the size to medium', () => {
    expect(parseSeedDataArgs(['--create-tenant', 'Iron Gym'])).toEqual({
      createTenant: 'Iron Gym',
      size: 'medium',
    });
  });

  it('accepts --fill with an explicit size', () => {
    expect(parseSeedDataArgs(['--fill', 'iron-gym', '--size', 'large'])).toEqual({
      fill: 'iron-gym',
      size: 'large',
    });
  });

  it('rejects both target flags at once', () => {
    expect(() => parseSeedDataArgs(['--create-tenant', 'A', '--fill', 'b'])).toThrow(
      /exactly one of --create-tenant or --fill/i,
    );
  });

  it('rejects neither target flag', () => {
    expect(() => parseSeedDataArgs(['--size', 'small'])).toThrow(
      /exactly one of --create-tenant or --fill/i,
    );
  });

  it('rejects a size outside small|medium|large and names the valid ones', () => {
    expect(() => parseSeedDataArgs(['--fill', 'x', '--size', 'huge'])).toThrow(
      /small.*medium.*large/i,
    );
  });

  it('rejects an unknown flag', () => {
    expect(() => parseSeedDataArgs(['--fill', 'x', '--trainees', '40'])).toThrow();
  });

  it('rejects an empty target value', () => {
    expect(() => parseSeedDataArgs(['--fill', ''])).toThrow();
  });

  it('returns help without demanding a target', () => {
    expect(parseSeedDataArgs(['--help']).help).toBe(true);
  });
});

describe('seedData', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SEED_DATA_PASSWORD = STRONG_PASSWORD;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('guards', () => {
    it('refuses to run in production without touching the database', async () => {
      process.env.NODE_ENV = 'production';
      await expect(seedData(prismaThatMustNotBeTouched(), createSmall)).rejects.toThrow(
        /production/i,
      );
    });

    it('rejects an unset SEED_DATA_PASSWORD without touching the database', async () => {
      delete process.env.SEED_DATA_PASSWORD;
      await expect(seedData(prismaThatMustNotBeTouched(), createSmall)).rejects.toThrow(
        /SEED_DATA_PASSWORD/,
      );
    });

    it('rejects the .env.example placeholder without touching the database', async () => {
      process.env.SEED_DATA_PASSWORD = 'REPLACE_BEFORE_DEPLOY';
      await expect(seedData(prismaThatMustNotBeTouched(), createSmall)).rejects.toThrow(
        /placeholder/i,
      );
    });

    it('rejects a password below the minimum length without touching the database', async () => {
      process.env.SEED_DATA_PASSWORD = 'short';
      await expect(seedData(prismaThatMustNotBeTouched(), createSmall)).rejects.toThrow(/12/);
    });

    it('never puts the rejected value in the error message', async () => {
      const secret = 'dev-leaky-value-that-must-not-surface';
      process.env.SEED_DATA_PASSWORD = secret;
      await expect(seedData(prismaThatMustNotBeTouched(), createSmall)).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining(secret) }),
      );
    });
  });

  describe('target resolution', () => {
    it('refuses --create-tenant when the slug already exists, and writes nothing', async () => {
      const stub = recordingPrisma({ id: TENANT_ID, slug: TENANT_SLUG, name: 'Iron Gym' });
      await expect(seedData(asClient(stub), createSmall)).rejects.toThrow(/--fill iron-gym/);
      expect(writeCallCount(stub)).toBe(0);
    });

    it('refuses --fill when no tenant matches, and writes nothing', async () => {
      const stub = recordingPrisma(null);
      await expect(seedData(asClient(stub), { fill: 'nope', size: 'small' })).rejects.toThrow(
        /nope/,
      );
      expect(writeCallCount(stub)).toBe(0);
    });

    it('slugifies the tenant name for --create-tenant', async () => {
      const stub = recordingPrisma(null);
      await seedData(asClient(stub), { createTenant: 'Iron  Gym & Co!', size: 'small' });
      expect(stub.tenant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Iron  Gym & Co!', slug: 'iron-gym-co' }),
        }),
      );
    });

    it('reuses an existing tenant found by id rather than slug', async () => {
      const stub = recordingPrisma(null);
      stub.tenant.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: TENANT_ID, slug: TENANT_SLUG, name: 'Iron Gym' });
      await seedData(asClient(stub), { fill: TENANT_ID, size: 'small' });
      expect(stub.tenant.create).not.toHaveBeenCalled();
      expect(stub.trainee.create).toHaveBeenCalled();
    });
  });

  describe('generated data', () => {
    it('stamps the resolved tenantId on every scoped row it writes', async () => {
      const stub = recordingPrisma(null);
      await seedData(asClient(stub), createSmall);
      const scoped = allWrittenData(stub);
      expect(scoped.length).toBeGreaterThan(0);
      for (const row of scoped) {
        expect(row.tenantId).toBe(TENANT_ID);
      }
    });

    it('gives every minor at least one contact person', async () => {
      const stub = recordingPrisma(null);
      await seedData(asClient(stub), { createTenant: 'Iron Gym', size: 'medium' });
      const eighteenYearsAgo = new Date();
      eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

      const minors = stub.trainee.create.mock.calls
        .map(([args]) => (args as CreateArgs).data)
        .filter((data) => (data.dateOfBirth as Date) > eighteenYearsAgo);

      expect(minors.length).toBeGreaterThan(0);
      for (const minor of minors) {
        const contacts = minor.contacts as { create: unknown[] } | undefined;
        expect(contacts?.create?.length ?? 0).toBeGreaterThanOrEqual(1);
      }
    });

    it('never writes a fee whose payments exceed its amount, and matches status to the ledger', async () => {
      const stub = recordingPrisma(null);
      await seedData(asClient(stub), { createTenant: 'Iron Gym', size: 'medium' });

      const fees = stub.fee.create.mock.calls.map(([args]) => (args as CreateArgs).data);
      expect(fees.length).toBeGreaterThan(0);

      let sawPaid = false;
      let sawPartial = false;
      let sawUnpaid = false;

      for (const fee of fees) {
        const amount = Number(fee.amount);
        const payments =
          (fee.payments as { create: { amount: unknown }[] } | undefined)?.create ?? [];
        const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);

        expect(paid).toBeLessThanOrEqual(amount);
        if (fee.status === 'PAID') {
          expect(paid).toBe(amount);
          sawPaid = true;
        } else if (fee.status === 'PARTIAL') {
          expect(paid).toBeGreaterThan(0);
          expect(paid).toBeLessThan(amount);
          sawPartial = true;
        } else {
          expect(paid).toBe(0);
          sawUnpaid = true;
        }
      }

      expect([sawPaid, sawPartial, sawUnpaid]).toEqual([true, true, true]);
    });

    it('pairs each billing mode with the price column it uses', async () => {
      const stub = recordingPrisma(null);
      await seedData(asClient(stub), { createTenant: 'Iron Gym', size: 'medium' });
      const classes = stub.class.upsert.mock.calls.map(
        ([args]) => (args as { create: Record<string, unknown> }).create,
      );
      expect(classes.length).toBeGreaterThan(1);
      for (const cls of classes) {
        if (cls.billingMode === 'PER_MONTH') {
          expect(cls.monthlyAmount).toBeDefined();
          expect(cls.sessionPrice).toBeUndefined();
        } else {
          expect(cls.sessionPrice).toBeDefined();
          expect(cls.monthlyAmount).toBeUndefined();
        }
      }
    });

    it('creates more trainees than one page holds at the default size', async () => {
      const stub = recordingPrisma(null);
      await seedData(asClient(stub), { createTenant: 'Iron Gym', size: 'medium' });
      // PaginationQueryDto defaults to 25 per page; the point of `medium` is a second page.
      expect(stub.trainee.create.mock.calls.length).toBeGreaterThan(25);
    });

    it('scales the batch with --size', async () => {
      const counts: number[] = [];
      for (const size of ['small', 'medium', 'large'] as const) {
        const stub = recordingPrisma(null);
        await seedData(asClient(stub), { createTenant: 'Iron Gym', size });
        counts.push(stub.trainee.create.mock.calls.length);
      }
      expect(counts[0]).toBeLessThan(counts[1]!);
      expect(counts[1]).toBeLessThan(counts[2]!);
    });

    it('marks past sessions completed and leaves future ones scheduled', async () => {
      const stub = recordingPrisma(null);
      await seedData(asClient(stub), createSmall);
      const sessions = stub.session.create.mock.calls.map(([args]) => (args as CreateArgs).data);
      const now = new Date();
      expect(sessions.length).toBeGreaterThan(0);
      for (const session of sessions) {
        const expected = (session.endsAt as Date) < now ? 'COMPLETED' : 'SCHEDULED';
        expect(session.status).toBe(expected);
      }
      expect(sessions.some((s) => s.status === 'COMPLETED')).toBe(true);
      expect(sessions.some((s) => s.status === 'SCHEDULED')).toBe(true);
    });

    it('reuses schedules and sessions that already exist rather than duplicating them', async () => {
      const stub = recordingPrisma(null);
      stub.classSchedule.findFirst.mockResolvedValue({ id: 'schedule-existing' });
      stub.session.findFirst.mockResolvedValue({
        id: 'session-existing',
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() - 82_800_000),
      });
      await seedData(asClient(stub), createSmall);
      expect(stub.classSchedule.create).not.toHaveBeenCalled();
      expect(stub.session.create).not.toHaveBeenCalled();
      // New trainees still get attendance against the sessions that were already there.
      expect(stub.attendance.createMany).toHaveBeenCalled();
    });
  });

  describe('run isolation', () => {
    it('gives two runs disjoint user emails', async () => {
      const emails = async () => {
        const stub = recordingPrisma(null);
        await seedData(asClient(stub), createSmall);
        return stub.user.create.mock.calls.map(
          ([args]) => (args as CreateArgs).data.email as string,
        );
      };
      const first = await emails();
      const second = await emails();
      expect(first.length).toBeGreaterThan(1);
      expect(first.filter((email) => second.includes(email))).toEqual([]);
    });

    it('gives every generated user a membership in the target tenant', async () => {
      const stub = recordingPrisma(null);
      await seedData(asClient(stub), createSmall);
      const users = stub.user.create.mock.calls.map(([args]) => (args as CreateArgs).data);
      expect(users.length).toBeGreaterThan(1);
      for (const user of users) {
        const memberships = user.memberships as { create: { tenantId: string; role: string } };
        expect(memberships.create.tenantId).toBe(TENANT_ID);
        expect(['ADMIN', 'EMPLOYEE', 'CUSTOMER']).toContain(memberships.create.role);
      }
    });

    it('never prints the password', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const stub = recordingPrisma(null);
      await seedData(asClient(stub), createSmall);
      const printed = log.mock.calls.flat().join(' ');
      expect(printed).not.toContain(STRONG_PASSWORD);
    });
  });
});
