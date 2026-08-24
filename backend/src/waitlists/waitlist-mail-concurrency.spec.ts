import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import {
  AttendanceStatus,
  BillingMode,
  ContactRelationship,
  WaitlistMode,
} from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendancesService } from '@/attendances/attendances.service';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { MailService } from '@/mail/mail.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SessionsService } from '@/sessions/sessions.service';
import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
import { sha256Hex } from './waitlist-claim';
import { WaitlistsService } from './waitlists.service';

/**
 * TKT-0129: the waitlist mails for one opening must go out concurrently, not one after
 * another. No existing spec can see the difference — they assert who was mailed, which is
 * true either way — so the check here is a gate: every send parks until the expected number
 * of sends has arrived. Serial code never reaches that number, so the first send parks
 * forever and the test fails on timeout. Concurrent code sails through.
 */
const { failFor } = vi.hoisted(() => ({ failFor: new Set<string>() }));

// AC #5: one trainee whose recipient lookup rejects must not cost the others their mail.
// Real behaviour for everybody not named in `failFor`.
vi.mock('@/waitlists/trainee-recipients', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./trainee-recipients')>();
  return {
    ...actual,
    traineeRecipients: async (db: Parameters<typeof actual.traineeRecipients>[0], id: string) => {
      if (failFor.has(id)) throw new Error(`trainee ${id} is unreadable`);
      return actual.traineeRecipients(db, id);
    },
  };
});

interface Gate {
  /** Records an arrival and parks until `expected` callers have arrived. Returns the 1-based arrival index. */
  enter(): Promise<number>;
  readonly entered: number;
}

function gate(expected: number): Gate {
  let entered = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return {
    get entered() {
      return entered;
    },
    async enter() {
      entered += 1;
      const index = entered;
      if (entered === expected) open();
      await opened;
      return index;
    },
  };
}

describe('waitlist mail fan-out', () => {
  let attendances: AttendancesService;
  let waitlists: WaitlistsService;
  let sessions: SessionsService;
  let prisma: PrismaService;
  const tenantIds: string[] = [];

  let activeGate: Gate | null = null;
  /** 1-based arrival index whose send throws, or 0 for none. */
  let failNth = 0;

  const enterGate = async (): Promise<void> => {
    const index = activeGate ? await activeGate.enter() : 0;
    if (index !== 0 && index === failNth) throw new Error('the mail server said no');
  };

  const offers = vi.fn(async (_options: { to: string; claimUrl: string }) => enterGate());
  const promotions = vi.fn(async (_options: { to: string }) => enterGate());
  const spotFilled = vi.fn(async (_options: { to: string }) => enterGate());

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      // The services read FRONTEND_URL for claim links — the same global config AppModule provides.
      imports: [ConfigModule.forRoot({ isGlobal: true })],
      providers: [
        AttendancesService,
        WaitlistsService,
        SessionsService,
        LocationScopeService,
        PrismaService,
        {
          provide: MailService,
          useValue: {
            sendWaitlistClaimOffer: offers,
            sendWaitlistPromotion: promotions,
            sendWaitlistSpotFilled: spotFilled,
          },
        },
      ],
    }).compile();
    attendances = moduleRef.get(AttendancesService);
    waitlists = moduleRef.get(WaitlistsService);
    sessions = moduleRef.get(SessionsService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.onModuleDestroy();
  });

  beforeEach(() => {
    activeGate = null;
    failNth = 0;
    failFor.clear();
    offers.mockClear();
    promotions.mockClear();
    spotFilled.mockClear();
  });

  afterEach(() => {
    activeGate = null;
  });

  async function newTenant() {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test', slug: `t-${randomUUID()}` },
    });
    tenantIds.push(tenant.id);
    return tenant;
  }

  async function newClass(tenantId: string, waitlistMode: WaitlistMode) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: 10,
        capacity: 1,
        waitlistMode,
      },
    });
  }

  /** A trainee with `contacts` contact people, each with an address, so the fan-out has width. */
  async function newTrainee(tenantId: string, contacts = 0) {
    const trainee = await prisma.trainee.create({
      data: { tenantId, firstName: 'T', lastName: randomUUID().slice(0, 8), dateOfBirth: new Date('2000-01-01') },
    });
    if (contacts > 0) {
      await prisma.contactPerson.createMany({
        data: Array.from({ length: contacts }, (_unused, i) => ({
          tenantId,
          traineeId: trainee.id,
          firstName: 'C',
          lastName: String(i),
          relationship: ContactRelationship.PARENT,
          email: `${randomUUID()}@contact.test`,
        })),
      });
    }
    return trainee;
  }

  /** A full session of `mode`, plus `queued` waitlisted trainees each carrying `contacts` addresses. */
  async function fullSession(mode: WaitlistMode, queued: number, contacts: number) {
    const tenant = await newTenant();
    const location = await prisma.location.create({
      data: { tenantId: tenant.id, name: `Loc-${randomUUID()}` },
    });
    const cls = await newClass(tenant.id, mode);
    // Far enough ahead that self-service is open — openClaimWindow and promoteFromWaitlist
    // both refuse to act once the booking cutoff has passed.
    const session = await sessions.create(
      tenant.id,
      {
        classId: cls.id,
        locationId: location.id,
        startsAt: '2027-06-01T18:00:00.000Z',
        endsAt: '2027-06-01T19:00:00.000Z',
      },
      su,
    );
    const sitting = await newTrainee(tenant.id);
    const booking = await prisma.attendance.create({
      data: {
        tenantId: tenant.id,
        sessionId: session.id,
        traineeId: sitting.id,
        status: AttendanceStatus.PENDING,
      },
    });
    const waiting = [];
    for (let i = 0; i < queued; i += 1) {
      const trainee = await newTrainee(tenant.id, contacts);
      await prisma.waitlistEntry.create({
        data: { tenantId: tenant.id, sessionId: session.id, traineeId: trainee.id },
      });
      waiting.push(trainee);
    }
    return { tenantId: tenant.id, sessionId: session.id, bookingId: booking.id, waiting };
  }

  const freeTheSpot = (s: { tenantId: string; sessionId: string; bookingId: string }) =>
    attendances.remove(s.tenantId, s.sessionId, su, s.bookingId);

  // AC #1
  it('claim offers for a full waitlist all start before any completes', async () => {
    const s = await fullSession(WaitlistMode.CLAIM, 5, 2);
    activeGate = gate(10);

    await freeTheSpot(s);

    expect(offers).toHaveBeenCalledTimes(10);
    expect(activeGate.entered).toBe(10);
  });

  // AC #2
  it('a rejected offer mail does not stop the other recipients', async () => {
    const s = await fullSession(WaitlistMode.CLAIM, 5, 2);
    activeGate = gate(10);
    failNth = 3;

    await expect(freeTheSpot(s)).resolves.toBeUndefined();

    expect(offers).toHaveBeenCalledTimes(10);
  });

  // AC #3. A freed spot promotes exactly one trainee (capacity − count), so the width here
  // is that trainee's contact list.
  it('promotion mails for one trainee\'s contacts all start before any completes', async () => {
    const s = await fullSession(WaitlistMode.FIFO_AUTO, 1, 3);
    activeGate = gate(3);

    await freeTheSpot(s);

    expect(promotions).toHaveBeenCalledTimes(3);
    expect(activeGate.entered).toBe(3);
  });

  // AC #4
  it('spot-filled mails all start before any completes', async () => {
    const s = await fullSession(WaitlistMode.CLAIM, 2, 2);
    await freeTheSpot(s); // offers go out ungated

    const claimUrl = offers.mock.calls[0]![0].claimUrl;
    const token = new URL(claimUrl).searchParams.get('token')!;
    activeGate = gate(2); // the other queued trainee's two contacts

    await waitlists.claim({ token });

    expect(spotFilled).toHaveBeenCalledTimes(2);
    expect(activeGate.entered).toBe(2);
  });

  // AC #5
  it('one unreadable trainee does not stop the rest of the fan-out', async () => {
    const s = await fullSession(WaitlistMode.CLAIM, 2, 2);
    failFor.add(s.waiting[0]!.id);

    await expect(freeTheSpot(s)).resolves.toBeUndefined();

    expect(offers).toHaveBeenCalledTimes(2); // only the readable trainee's two contacts
  });

  // AC #6. Unchanged behaviour — openClaimWindow commits its tokens inside the freeing
  // transaction, so concurrency cannot let a link arrive before its row exists.
  it('every mailed claim token resolves to a stored token row', async () => {
    const s = await fullSession(WaitlistMode.CLAIM, 3, 1);

    await freeTheSpot(s);

    expect(offers).toHaveBeenCalledTimes(3);
    for (const [options] of offers.mock.calls) {
      const token = new URL(options.claimUrl).searchParams.get('token')!;
      const row = await prisma.waitlistClaimToken.findUnique({
        where: { tokenHash: sha256Hex(token) },
      });
      expect(row).not.toBeNull();
      expect(row!.sessionId).toBe(s.sessionId);
    }
  });
});
