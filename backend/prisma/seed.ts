/**
 * Idempotent seed: Super Admin (from env), dummy tenant with an Admin, a Teacher
 * and a Customer (deterministic local-dev passwords), plus a demo club populated
 * well enough to exercise every screen.
 *
 * Run with: `npm run seed` (or `npx prisma db seed`).
 */
import {
  AttendanceStatus,
  AttendanceRsvp,
  BillingMode,
  ContactRelationship,
  DayOfWeek,
  FeeStatus,
  Prisma,
  PrismaClient,
  SessionStatus,
  UserRole,
} from '@prisma/client';
import bcrypt from 'bcrypt';
// Relative, not `@/` — this runs under ts-node without tsconfig-paths.
import { looksLikePlaceholder, shouldSeedDemoData } from '../src/common/credential-guards';

const BCRYPT_ROUNDS = 10;
// A human-chosen password, so the 32-char JWT key floor is the wrong number to reuse.
const MIN_SUPERADMIN_PASSWORD_LENGTH = 12;

const DEMO_TENANT_SLUG = 'demo-sports-club';
const DEMO_TENANT_NAME = 'Demo Sports Club';
const DEMO_ADMIN_EMAIL = 'admin@demo.pulsedesk.local';
const DEMO_ADMIN_PASSWORD = 'DemoAdmin!Pass1';
const DEMO_TEACHER_EMAIL = 'teacher@demo.pulsedesk.local';
const DEMO_TEACHER_PASSWORD = 'DemoTeacher!Pass1';
const DEMO_CUSTOMER_EMAIL = 'parent@demo.pulsedesk.local';
const DEMO_CUSTOMER_PASSWORD = 'DemoParent!Pass1';
const DEMO_LOCATION_NAME = 'Central Hall';
const DEMO_LOCATION_ADDRESS = '1 Demo Street';

const JUDO_CLASS_NAME = 'Junior Judo';
const CONDITIONING_CLASS_NAME = 'Adult Conditioning';
const JUDO_MONTHLY_AMOUNT = '80';
const CONDITIONING_SESSION_PRICE = '15';
// Enough of the current month's 80 to land the fee on PARTIAL rather than PAID.
const PARTIAL_PAYMENT_AMOUNT = '30';

// Three weeks of sessions ending in the current one: two weeks of history to mark
// attendance against, plus upcoming sessions for the customer portal to RSVP to.
const WEEK_OFFSETS = [-2, -1, 0] as const;
// Months the PER_MONTH fees cover, counting back from the current one. The dashboard's
// default window is the last six, so three keeps the chart from reading as a single bar.
const FEE_MONTH_OFFSETS = [2, 1, 0] as const;

export async function seed(prisma: PrismaClient): Promise<void> {
  const superEmail = process.env.SUPERADMIN_EMAIL;
  const superPassword = process.env.SUPERADMIN_PASSWORD;
  if (!superEmail || !superPassword) {
    throw new Error('SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set in .env');
  }
  // Checked before the first write, so a rejected run leaves no partial state. The
  // super admin has tenantId = NULL and bypasses every @Roles check, so seeding it with
  // the .env.example placeholder would publish the most privileged account's password.
  // Never echo the value — this can reach CI logs.
  if (looksLikePlaceholder(superPassword)) {
    throw new Error('SUPERADMIN_PASSWORD is still a placeholder; set a real password before seeding.');
  }
  if (superPassword.length < MIN_SUPERADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `SUPERADMIN_PASSWORD is shorter than ${MIN_SUPERADMIN_PASSWORD_LENGTH} characters; refusing to seed.`,
    );
  }
  const seedDemo = shouldSeedDemoData(process.env.NODE_ENV);

  // Super Admin (no memberships).
  const existingSuper = await prisma.user.findFirst({
    where: { email: superEmail, isSuperAdmin: true },
  });
  if (!existingSuper) {
    await prisma.user.create({
      data: {
        email: superEmail,
        passwordHash: await bcrypt.hash(superPassword, BCRYPT_ROUNDS),
        isSuperAdmin: true,
        firstName: 'Super',
        lastName: 'Admin',
      },
    });
  }

  // Demo data carries passwords hardcoded above, so it is dev/test only. The super admin
  // above stays unconditional — seeding that in production is the point.
  if (seedDemo) {
    // Dummy tenant.
    const tenant = await prisma.tenant.upsert({
      where: { slug: DEMO_TENANT_SLUG },
      update: { name: DEMO_TENANT_NAME, isActive: true },
      create: { slug: DEMO_TENANT_SLUG, name: DEMO_TENANT_NAME, isActive: true },
    });

    // One location for the demo staff to work in. TKT-0054: ADMIN and EMPLOYEE read only their
    // assigned locations, so a demo account without one signs in to empty lists.
    const location = await prisma.location.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: DEMO_LOCATION_NAME } },
      update: { isActive: true },
      create: { tenantId: tenant.id, name: DEMO_LOCATION_NAME, address: DEMO_LOCATION_ADDRESS },
    });
    // Applied on `update` as well as `create`, so re-seeding backfills a database whose demo
    // accounts predate the scoping rule. `connect` is idempotent.
    const assignedToDemoLocation = { locations: { connect: [{ id: location.id }] } };

    // Demo Admin (membership carries the role).
    await prisma.user.upsert({
      where: { email: DEMO_ADMIN_EMAIL },
      update: assignedToDemoLocation,
      create: {
        email: DEMO_ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(DEMO_ADMIN_PASSWORD, BCRYPT_ROUNDS),
        firstName: 'Demo',
        lastName: 'Admin',
        memberships: { create: { tenantId: tenant.id, role: UserRole.ADMIN } },
        ...assignedToDemoLocation,
      },
    });

    // Demo Teacher (Employee role).
    const teacher = await prisma.user.upsert({
      where: { email: DEMO_TEACHER_EMAIL },
      update: assignedToDemoLocation,
      create: {
        email: DEMO_TEACHER_EMAIL,
        passwordHash: await bcrypt.hash(DEMO_TEACHER_PASSWORD, BCRYPT_ROUNDS),
        firstName: 'Demo',
        lastName: 'Teacher',
        memberships: { create: { tenantId: tenant.id, role: UserRole.EMPLOYEE } },
        ...assignedToDemoLocation,
      },
    });

    // Demo Customer — a guardian, so the portal has an account to sign in with. No location:
    // customers are scoped by ownership, not by assignment (LocationScopeService returns null
    // for them), and giving them one would imply a rule that does not exist.
    const customer = await prisma.user.upsert({
      where: { email: DEMO_CUSTOMER_EMAIL },
      update: {},
      create: {
        email: DEMO_CUSTOMER_EMAIL,
        passwordHash: await bcrypt.hash(DEMO_CUSTOMER_PASSWORD, BCRYPT_ROUNDS),
        firstName: 'Demo',
        lastName: 'Parent',
        memberships: { create: { tenantId: tenant.id, role: UserRole.CUSTOMER } },
      },
    });

    // ponytail: the domain data below is generated once, keyed on "does this tenant have
    // classes yet". Trainee, Session, Fee and Payment have no unique constraint to upsert
    // against, and one count beats five hand-rolled dedup keys. Consequence: re-seeding does
    // not refresh the session dates — drop dev.db and re-migrate for that. Upgrade path is a
    // per-model findFirst keyed on (classId, locationId, startsAt) and friends, mirroring
    // ClassSchedulesService.generateSessions' dedupKey.
    const alreadySeeded = (await prisma.class.count({ where: { tenantId: tenant.id } })) > 0;
    if (!alreadySeeded) {
      await seedDemoDomain(prisma, {
        tenantId: tenant.id,
        locationId: location.id,
        teacher,
        customerId: customer.id,
      });
    }
  }

  /* eslint-disable no-console */
  console.log('\n✔ Seed complete.');
  console.log('  Super Admin:   ', superEmail, '(password from SUPERADMIN_PASSWORD env)');
  if (seedDemo) {
    console.log('  Demo tenant:   ', DEMO_TENANT_SLUG);
    console.log('  Demo location: ', DEMO_LOCATION_NAME, '(both demo staff are assigned to it)');
    console.log('  Demo Admin:    ', DEMO_ADMIN_EMAIL, '(demo password set; see prisma/seed.ts source)');
    console.log('  Demo Teacher:  ', DEMO_TEACHER_EMAIL, '(demo password set; see prisma/seed.ts source)');
    console.log('  Demo Customer: ', DEMO_CUSTOMER_EMAIL, '(demo password set; see prisma/seed.ts source)');
    console.log('  Demo classes:  ', JUDO_CLASS_NAME, '+', CONDITIONING_CLASS_NAME);
  } else {
    console.log('  Demo data:      skipped (NODE_ENV=production)');
  }
  /* eslint-enable no-console */
}

// === Demo domain data ===================================================================
// Hand-rolled rather than driven through ClassSchedulesService / SessionsService /
// FeesService: those take (tenantId, dto, AuthenticatedUser) and need a Nest application
// context, and this file runs under plain ts-node. The one rule worth copying is the
// auto-attendance in sessions.service.ts — one row per enrolled trainee per session.

interface DemoDomainRefs {
  tenantId: string;
  locationId: string;
  teacher: { id: string; email: string; firstName: string | null; lastName: string | null };
  customerId: string;
}

/** Wall-clock Monday of the week `d` falls in. Local, to match atTime below. */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // JS Sunday is 0; shift so Monday is 0
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Same local wall-clock semantics as ClassSchedulesService.combineDateAndTime. */
export function atTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const x = new Date(date);
  x.setHours(h, m, 0, 0);
  return x;
}

/** A date `years` before now — enough to make a trainee reliably a minor or an adult. */
export function birthDate(years: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, 5, 15));
}

// UTC month boundaries, matching common/dates.ts startOfMonth/endOfMonth. Not imported:
// that module pulls in @nestjs/common, which this seed deliberately stays clear of.
export function monthStartUtc(monthsAgo: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
}

export function monthEndUtc(monthsAgo: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 0, 23, 59, 59, 999),
  );
}

// Cycles all four AttendanceStatus values across the (session, trainee) grid, so the
// attendance screens have something other than PRESENT to render.
export const MARKED_STATUSES = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.PRESENT,
  AttendanceStatus.ABSENT,
  AttendanceStatus.EXCUSED,
] as const;

const DEMO_PHONE = '+359 888 000 000';

async function seedDemoDomain(prisma: PrismaClient, refs: DemoDomainRefs): Promise<void> {
  const { tenantId, locationId, teacher, customerId } = refs;
  const atThisLocation = { locations: { connect: [{ id: locationId }] } };

  // --- Classes. One of each billing mode, so both fee flavours are represented. ---
  const judo = await prisma.class.upsert({
    where: { tenantId_name: { tenantId, name: JUDO_CLASS_NAME } },
    update: {},
    create: {
      tenantId,
      name: JUDO_CLASS_NAME,
      description: 'Judo for children, twice a week.',
      billingMode: BillingMode.PER_MONTH,
      monthlyAmount: new Prisma.Decimal(JUDO_MONTHLY_AMOUNT),
      trainers: { connect: [{ id: teacher.id }] },
      ...atThisLocation,
    },
  });
  const conditioning = await prisma.class.upsert({
    where: { tenantId_name: { tenantId, name: CONDITIONING_CLASS_NAME } },
    update: {},
    create: {
      tenantId,
      name: CONDITIONING_CLASS_NAME,
      description: 'Strength and conditioning for adults, billed per session.',
      billingMode: BillingMode.PER_SESSION,
      sessionPrice: new Prisma.Decimal(CONDITIONING_SESSION_PRICE),
      trainers: { connect: [{ id: teacher.id }] },
      ...atThisLocation,
    },
  });

  // --- Trainees. Every one is connected to the demo location: ADMIN and EMPLOYEE reads are
  // filtered by assigned location, so a trainee without one is invisible to both. ---
  // The three minors each carry a guardian contact, which is the under-18 rule from the PRD.
  // Two of them also link to the demo customer, so the portal and me/* routes return rows.
  const minorSpecs = [
    {
      firstName: 'Ivan',
      lastName: 'Petrov',
      age: 10,
      contact: {
        firstName: 'Rositsa',
        lastName: 'Petrova',
        relationship: ContactRelationship.PARENT,
      },
      guardian: true,
    },
    {
      firstName: 'Maria',
      lastName: 'Dimitrova',
      age: 12,
      contact: {
        firstName: 'Dimitar',
        lastName: 'Dimitrov',
        relationship: ContactRelationship.PARENT,
      },
      guardian: true,
    },
    {
      firstName: 'Georgi',
      lastName: 'Ivanov',
      age: 15,
      contact: {
        firstName: 'Yordanka',
        lastName: 'Ivanova',
        relationship: ContactRelationship.GRANDPARENT,
      },
      guardian: false,
    },
  ];

  const judoTrainees: { id: string }[] = [];
  for (const spec of minorSpecs) {
    judoTrainees.push(
      await prisma.trainee.create({
        data: {
          tenantId,
          firstName: spec.firstName,
          lastName: spec.lastName,
          dateOfBirth: birthDate(spec.age),
          classes: { connect: [{ id: judo.id }] },
          ...atThisLocation,
          ...(spec.guardian ? { guardians: { connect: [{ id: customerId }] } } : {}),
          // Nested create, as the PRD prescribes for the under-18 path.
          contacts: {
            create: [
              {
                tenantId,
                firstName: spec.contact.firstName,
                lastName: spec.contact.lastName,
                relationship: spec.contact.relationship,
                phone: DEMO_PHONE,
                isPrimary: true,
              },
            ],
          },
        },
      }),
    );
  }

  const adultSpecs = [
    { firstName: 'Elena', lastName: 'Stoyanova', age: 28 },
    { firstName: 'Nikolay', lastName: 'Georgiev', age: 34 },
    { firstName: 'Petar', lastName: 'Kolev', age: 41 },
  ];
  const conditioningTrainees: { id: string }[] = [];
  for (const spec of adultSpecs) {
    conditioningTrainees.push(
      await prisma.trainee.create({
        data: {
          tenantId,
          firstName: spec.firstName,
          lastName: spec.lastName,
          dateOfBirth: birthDate(spec.age),
          phone: DEMO_PHONE,
          classes: { connect: [{ id: conditioning.id }] },
          ...atThisLocation,
        },
      }),
    );
  }

  // --- Weekly schedule templates, and the sessions materialised from them. ---
  // dayOffset is days from Monday; it saves mapping the DayOfWeek enum back to an index.
  const slots = [
    {
      cls: judo,
      trainees: judoTrainees,
      dayOfWeek: DayOfWeek.MON,
      dayOffset: 0,
      startTime: '17:00',
      endTime: '18:00',
    },
    {
      cls: judo,
      trainees: judoTrainees,
      dayOfWeek: DayOfWeek.WED,
      dayOffset: 2,
      startTime: '17:00',
      endTime: '18:00',
    },
    {
      cls: conditioning,
      trainees: conditioningTrainees,
      dayOfWeek: DayOfWeek.TUE,
      dayOffset: 1,
      startTime: '19:00',
      endTime: '20:00',
    },
    {
      cls: conditioning,
      trainees: conditioningTrainees,
      dayOfWeek: DayOfWeek.THU,
      dayOffset: 3,
      startTime: '19:00',
      endTime: '20:00',
    },
  ];

  for (const slot of slots) {
    await prisma.classSchedule.create({
      data: {
        tenantId,
        classId: slot.cls.id,
        locationId,
        dayOfWeek: slot.dayOfWeek,
        startTime: slot.startTime,
        endTime: slot.endTime,
      },
    });
  }

  const now = new Date();
  const thisMonday = mondayOf(now);
  const teacherName = [teacher.firstName, teacher.lastName].filter(Boolean).join(' ');
  const conditioningPastSessions: { id: string; startsAt: Date; endsAt: Date }[] = [];

  for (const [weekIndex, weekOffset] of WEEK_OFFSETS.entries()) {
    const weekMonday = addDays(thisMonday, weekOffset * 7);
    for (const slot of slots) {
      const day = addDays(weekMonday, slot.dayOffset);
      const startsAt = atTime(day, slot.startTime);
      const endsAt = atTime(day, slot.endTime);
      const isPast = endsAt.getTime() < now.getTime();

      const session = await prisma.session.create({
        data: {
          tenantId,
          classId: slot.cls.id,
          locationId,
          startsAt,
          endsAt,
          status: isPast ? SessionStatus.COMPLETED : SessionStatus.SCHEDULED,
          trainers: { connect: [{ id: teacher.id }] },
        },
      });
      if (isPast && slot.cls.id === conditioning.id) {
        conditioningPastSessions.push({ id: session.id, startsAt, endsAt });
      }

      // Mirrors the auto-attendance in sessions.service.ts: one row per enrolled trainee.
      // A past session is written already marked, by the teacher, carrying the same audit
      // snapshot the service would have stored; an upcoming one stays PENDING and gets an
      // RSVP or two so the customer portal has something to show.
      await prisma.attendance.createMany({
        data: slot.trainees.map((trainee, t) =>
          isPast
            ? {
                tenantId,
                sessionId: session.id,
                traineeId: trainee.id,
                status: MARKED_STATUSES[(weekIndex + t) % MARKED_STATUSES.length]!,
                markedAt: endsAt,
                markedById: teacher.id,
                markedByEmailSnapshot: teacher.email,
                markedByNameSnapshot: teacherName,
              }
            : {
                tenantId,
                sessionId: session.id,
                traineeId: trainee.id,
                status: AttendanceStatus.PENDING,
                traineeRsvp:
                  t === 0 ? AttendanceRsvp.CONFIRMED : t === 1 ? AttendanceRsvp.DECLINED : null,
              },
        ),
      });
    }
  }

  // --- Fees. PER_MONTH for judo across three months, PER_SESSION for conditioning. ---
  // Written with `status` already set: the PAID/PARTIAL recompute lives in FeesService and
  // runs only on the HTTP path, so a direct insert has to state the truth itself.
  const recordedBy = {
    method: 'cash',
    recordedById: teacher.id,
    recordedByEmailSnapshot: teacher.email,
    recordedByNameSnapshot: teacherName,
  };

  for (const monthsAgo of FEE_MONTH_OFFSETS) {
    const periodStart = monthStartUtc(monthsAgo);
    const periodEnd = monthEndUtc(monthsAgo);
    const closedMonth = monthsAgo > 0;

    for (const [index, trainee] of judoTrainees.entries()) {
      // Closed months are settled in full. The current month keeps one partial payment and
      // two untouched fees, so all three FeeStatus values are visible on the fees screen.
      const partial = !closedMonth && index === 0;
      const paidAmount = closedMonth
        ? JUDO_MONTHLY_AMOUNT
        : partial
          ? PARTIAL_PAYMENT_AMOUNT
          : null;

      await prisma.fee.create({
        data: {
          tenantId,
          classId: judo.id,
          traineeId: trainee.id,
          periodStart,
          periodEnd,
          amount: new Prisma.Decimal(JUDO_MONTHLY_AMOUNT),
          status: closedMonth ? FeeStatus.PAID : partial ? FeeStatus.PARTIAL : FeeStatus.UNPAID,
          payments:
            paidAmount === null
              ? undefined
              : {
                  create: [
                    {
                      tenantId,
                      amount: new Prisma.Decimal(paidAmount),
                      paidAt: closedMonth ? periodEnd : periodStart,
                      ...recordedBy,
                    },
                  ],
                },
        },
      });
    }
  }

  // One per-session charge per adult against the most recent completed conditioning session
  // — the shape the "generate session fees" flow produces. Left UNPAID.
  const lastConditioning = conditioningPastSessions.at(-1);
  if (lastConditioning) {
    for (const trainee of conditioningTrainees) {
      await prisma.fee.create({
        data: {
          tenantId,
          classId: conditioning.id,
          traineeId: trainee.id,
          sessionId: lastConditioning.id,
          periodStart: lastConditioning.startsAt,
          periodEnd: lastConditioning.endsAt,
          amount: new Prisma.Decimal(CONDITIONING_SESSION_PRICE),
          status: FeeStatus.UNPAID,
        },
      });
    }
  }
}

// No top-level invocation on purpose — `prisma/seed-run.ts` is the entry point. Keeping
// this module side-effect-free is what lets seed.spec.ts import and test it without
// running a real seed against the dev database.
