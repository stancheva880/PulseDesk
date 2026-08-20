import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { seed } from './seed';

// TKT-0034 — these replace the six manual-only AC opt-outs from TKT-0033. No database:
// seed() takes its client as a parameter, so a stub is enough to observe exactly which
// writes it attempts.

const STRONG_PASSWORD = 'a-real-super-admin-password';

const DEMO_ADMIN_EMAIL = 'admin@demo.pulsedesk.local';
const DEMO_TEACHER_EMAIL = 'teacher@demo.pulsedesk.local';
const DEMO_CUSTOMER_EMAIL = 'parent@demo.pulsedesk.local';

interface UserUpsertPayload {
  where: { email: string };
  create: { locations?: { connect: { id: string }[] } };
  update: { locations?: { connect: { id: string }[] } };
}

/** The user.upsert payloads addressed to the given emails, in call order. */
function upsertsFor(
  prisma: ReturnType<typeof recordingPrisma>,
  emails: string[],
): UserUpsertPayload[] {
  return prisma.user.upsert.mock.calls
    .map(([args]) => args as UserUpsertPayload)
    .filter((payload) => emails.includes(payload.where.email));
}

// Throws on ANY property access, so reaching the database at all fails the test. This is
// what makes "rejects before the first write" a proven property rather than an argument
// from the order of statements.
function prismaThatMustNotBeTouched(): PrismaClient {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`seed() touched the database (prisma.${String(prop)}) before validating`);
      },
    },
  ) as PrismaClient;
}

function recordingPrisma() {
  return {
    language: { upsert: vi.fn().mockResolvedValue({}) },
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({ id: 'user-1', email: 'demo@test.local' }),
    },
    tenant: { upsert: vi.fn().mockResolvedValue({ id: 'tenant-1' }) },
    location: { upsert: vi.fn().mockResolvedValue({ id: 'location-1' }) },
    // The demo domain data. `class.count` returning 0 is what makes seed() treat the tenant
    // as not yet populated and run the block at all.
    class: {
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn().mockResolvedValue({ id: 'class-1' }),
    },
    trainee: { create: vi.fn().mockResolvedValue({ id: 'trainee-1' }) },
    classSchedule: { create: vi.fn().mockResolvedValue({ id: 'schedule-1' }) },
    session: { create: vi.fn().mockResolvedValue({ id: 'session-1' }) },
    attendance: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    fee: { create: vi.fn().mockResolvedValue({ id: 'fee-1' }) },
  };
}

describe('seed', () => {
  beforeEach(() => {
    vi.stubEnv('SUPERADMIN_EMAIL', 'superadmin@test.local');
    vi.stubEnv('SUPERADMIN_PASSWORD', STRONG_PASSWORD);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('super-admin credential validation', () => {
    it('rejects the .env.example placeholder without touching the database', async () => {
      vi.stubEnv('SUPERADMIN_PASSWORD', 'REPLACE_BEFORE_DEPLOY');
      await expect(seed(prismaThatMustNotBeTouched())).rejects.toThrow(/placeholder/);
    });

    it('rejects a password below the minimum length without touching the database', async () => {
      vi.stubEnv('SUPERADMIN_PASSWORD', 'short1');
      await expect(seed(prismaThatMustNotBeTouched())).rejects.toThrow(/shorter than 12/);
    });

    it('rejects an unset password without touching the database', async () => {
      vi.stubEnv('SUPERADMIN_PASSWORD', '');
      await expect(seed(prismaThatMustNotBeTouched())).rejects.toThrow();
    });

    it('never puts the rejected value in the error message', async () => {
      vi.stubEnv('SUPERADMIN_PASSWORD', 'hunter2-but-short');
      await expect(seed(prismaThatMustNotBeTouched())).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('hunter2') }) as Error,
      );
    });

    it('proceeds with a strong password', async () => {
      const prisma = recordingPrisma();
      await expect(seed(prisma as unknown as PrismaClient)).resolves.toBeUndefined();
      expect(prisma.user.create).toHaveBeenCalledOnce(); // the super admin
    });
  });

  describe('demo data fence', () => {
    it('does not create the demo tenant or demo users in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const prisma = recordingPrisma();

      await seed(prisma as unknown as PrismaClient);

      expect(prisma.tenant.upsert).not.toHaveBeenCalled();
      expect(prisma.user.upsert).not.toHaveBeenCalled();
      // ...while the legitimate production seed still runs.
      expect(prisma.language.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.user.create).toHaveBeenCalledOnce();
    });

    it('creates the demo tenant and all three demo users outside production', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const prisma = recordingPrisma();

      await seed(prisma as unknown as PrismaClient);

      expect(prisma.tenant.upsert).toHaveBeenCalledOnce();
      // Admin, teacher and the customer guardian. Approved TEST CHANGE REQUEST: this was 2
      // before the demo club gained a CUSTOMER account for the portal.
      expect(prisma.user.upsert).toHaveBeenCalledTimes(3);
    });

    // TKT-0054: ADMIN and EMPLOYEE read only their assigned locations, so demo staff without one
    // would sign in to empty lists.
    it('creates a demo location outside production', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const prisma = recordingPrisma();

      await seed(prisma as unknown as PrismaClient);

      expect(prisma.location.upsert).toHaveBeenCalledOnce();
    });

    it('does not create the demo location in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const prisma = recordingPrisma();

      await seed(prisma as unknown as PrismaClient);

      expect(prisma.location.upsert).not.toHaveBeenCalled();
    });

    it('assigns the demo location to both demo staff, on create and on re-seed', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const prisma = recordingPrisma();

      await seed(prisma as unknown as PrismaClient);

      // Staff only. Approved TEST CHANGE REQUEST: this used to walk every upsert call, which
      // held while every demo account was staff. The customer is asserted separately below —
      // LocationScopeService returns null for CUSTOMER, so assigning one would imply a rule
      // that does not exist.
      const staff = upsertsFor(prisma, [DEMO_ADMIN_EMAIL, DEMO_TEACHER_EMAIL]);
      expect(staff).toHaveLength(2);
      for (const payload of staff) {
        expect(payload.create.locations?.connect).toEqual([{ id: 'location-1' }]);
        // The update half is what turns a re-seed into a backfill for an existing database.
        expect(payload.update.locations?.connect).toEqual([{ id: 'location-1' }]);
      }
    });

    it('never assigns a location to the demo customer', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const prisma = recordingPrisma();

      await seed(prisma as unknown as PrismaClient);

      const [customer, ...extra] = upsertsFor(prisma, [DEMO_CUSTOMER_EMAIL]);
      expect(extra).toHaveLength(0);
      expect(customer?.create.locations).toBeUndefined();
      expect(customer?.update.locations).toBeUndefined();
    });

    it('does not name demo accounts in the summary when they were not created', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await seed(recordingPrisma() as unknown as PrismaClient);

      const printed = log.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(printed).not.toContain('admin@demo.pulsedesk.local');
      expect(printed).not.toContain('teacher@demo.pulsedesk.local');
      expect(printed).not.toContain('parent@demo.pulsedesk.local');
      expect(printed).toContain('skipped');
    });

    // Additive to the fence above: the domain data carries the same hardcoded demo passwords'
    // blast radius — it describes invented families — so it sits behind the same NODE_ENV gate.
    it('does not create any demo domain data in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const prisma = recordingPrisma();

      await seed(prisma as unknown as PrismaClient);

      expect(prisma.class.count).not.toHaveBeenCalled();
      expect(prisma.class.upsert).not.toHaveBeenCalled();
      expect(prisma.trainee.create).not.toHaveBeenCalled();
      expect(prisma.classSchedule.create).not.toHaveBeenCalled();
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(prisma.attendance.createMany).not.toHaveBeenCalled();
      expect(prisma.fee.create).not.toHaveBeenCalled();
    });

    it('creates the demo domain data outside production', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const prisma = recordingPrisma();

      await seed(prisma as unknown as PrismaClient);

      expect(prisma.class.upsert).toHaveBeenCalledTimes(2); // one PER_MONTH, one PER_SESSION
      expect(prisma.trainee.create).toHaveBeenCalledTimes(6);
      expect(prisma.classSchedule.create).toHaveBeenCalledTimes(4);
      expect(prisma.session.create).toHaveBeenCalledTimes(12); // 4 weekly slots x 3 weeks
      expect(prisma.attendance.createMany).toHaveBeenCalledTimes(12); // one call per session
      expect(prisma.fee.create).toHaveBeenCalledTimes(12); // 9 monthly + 3 per-session
    });

    // The count guard is the whole idempotency story for the models with no unique key.
    it('skips the domain data when the tenant already has classes', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const prisma = recordingPrisma();
      prisma.class.count.mockResolvedValue(1);

      await seed(prisma as unknown as PrismaClient);

      expect(prisma.trainee.create).not.toHaveBeenCalled();
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(prisma.fee.create).not.toHaveBeenCalled();
      // ...while the accounts and the location are still repaired on a re-seed.
      expect(prisma.location.upsert).toHaveBeenCalledOnce();
    });

    // Every minor gets a guardian contact in the same nested create, which is the PRD's
    // under-18 rule. Asserted here so a future edit cannot quietly drop the contacts.
    it('gives every minor trainee a nested guardian contact', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const prisma = recordingPrisma();

      await seed(prisma as unknown as PrismaClient);

      const withContacts = prisma.trainee.create.mock.calls.filter(([args]) => {
        const payload = args as { data: { contacts?: { create: unknown[] } } };
        return (payload.data.contacts?.create.length ?? 0) > 0;
      });
      expect(withContacts).toHaveLength(3);
    });

    it('never prints the demo passwords, in either mode', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await seed(recordingPrisma() as unknown as PrismaClient);

      const printed = log.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(printed).not.toContain('DemoAdmin!Pass1');
      expect(printed).not.toContain('DemoTeacher!Pass1');
      expect(printed).not.toContain('DemoParent!Pass1');
      expect(printed).not.toContain(STRONG_PASSWORD);
    });
  });
});
