/**
 * On-demand demo data, on top of what `npm run seed` bootstraps.
 *
 *   npm run seed:data --workspace backend -- --create-tenant "Iron Gym" --size medium
 *   npm run seed:data --workspace backend -- --fill iron-gym --size large
 *
 * Every run appends: users, trainees, fees and payments are new rows carrying a per-run
 * tag, so the data set grows and `User.email @unique` never collides. Locations, classes,
 * schedules and sessions are reused when they already exist — duplicating those would
 * multiply sessions and attendance without adding anything to look at.
 *
 * Side-effect-free on import, same rule as seed.ts: the entry point is seed-run.ts, so
 * seed-data.spec.ts can import this and pass its own stub client.
 */
import {
  AttendanceRsvp,
  AttendanceStatus,
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
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
// Relative, not `@/` — this runs under ts-node without tsconfig-paths.
import { looksLikePlaceholder, shouldSeedDemoData } from '../src/common/credential-guards';
// The date helpers and the attendance-status cycle already exist for the bootstrap seed.
import {
  MARKED_STATUSES,
  addDays,
  atTime,
  birthDate,
  mondayOf,
  monthEndUtc,
  monthStartUtc,
} from './seed';

const BCRYPT_ROUNDS = 10;
// A human-chosen password, so the 32-char JWT key floor is the wrong number to reuse.
const MIN_PASSWORD_LENGTH = 12;

export const SEED_SIZES = {
  small: { locations: 1, classes: 2, trainers: 1, customers: 2, trainees: 8 },
  medium: { locations: 2, classes: 4, trainers: 3, customers: 5, trainees: 30 },
  large: { locations: 3, classes: 6, trainers: 6, customers: 12, trainees: 120 },
} as const;

export type SeedSize = keyof typeof SEED_SIZES;

export interface SeedDataOptions {
  createTenant?: string;
  fill?: string;
  size: SeedSize;
  help?: boolean;
}

export const SEED_DATA_USAGE = `Usage:
  npm run seed:data --workspace backend -- --create-tenant "<name>" [--size small|medium|large]
  npm run seed:data --workspace backend -- --fill <slug|id>          [--size small|medium|large]

  --create-tenant  Create a new club and populate it. Fails if the slug already exists.
  --fill           Append another batch to an existing club, by slug or id.
  --size           Batch size. Default: medium.

Requires SEED_DATA_PASSWORD (12+ chars); every generated account gets it. Refuses to run
when NODE_ENV=production.`;

const SIZE_NAMES = Object.keys(SEED_SIZES).join(', ');

export function parseSeedDataArgs(args: string[]): SeedDataOptions {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      'create-tenant': { type: 'string' },
      fill: { type: 'string' },
      size: { type: 'string', default: 'medium' },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help) return { help: true, size: 'medium' };

  const createTenant = values['create-tenant']?.trim();
  const fill = values.fill?.trim();
  if (Number(Boolean(createTenant)) + Number(Boolean(fill)) !== 1) {
    throw new Error(`Pass exactly one of --create-tenant or --fill.\n\n${SEED_DATA_USAGE}`);
  }

  const size = values.size as string;
  if (!Object.prototype.hasOwnProperty.call(SEED_SIZES, size)) {
    throw new Error(`Unknown --size "${size}". Valid sizes: ${SIZE_NAMES}.`);
  }

  return createTenant
    ? { createTenant, size: size as SeedSize }
    : { fill: fill as string, size: size as SeedSize };
}

// --- Data pools. Hand-written rather than a faker dependency: two pools indexed with
// different strides give varied combinations in a few lines.
const FIRST_NAMES = [
  'Ivan',
  'Maria',
  'Georgi',
  'Elena',
  'Nikolay',
  'Petar',
  'Yana',
  'Dimitar',
  'Sofia',
  'Kaloyan',
  'Rada',
  'Boris',
];
const LAST_NAMES = [
  'Petrov',
  'Ivanova',
  'Dimitrov',
  'Stoyanova',
  'Georgiev',
  'Koleva',
  'Angelov',
  'Marinova',
  'Todorov',
  'Nikolova',
  'Vasilev',
  'Hristova',
];
const LOCATION_NAMES = ['Central Hall', 'North Hall', 'Riverside Hall'];
const CLASS_NAMES = [
  'Junior Judo',
  'Adult Conditioning',
  'Boxing Basics',
  'Yoga Flow',
  'Karate Kids',
  'Spin Class',
];
const PHONE = '+359 888 000 000';
const WEEKDAYS = [DayOfWeek.MON, DayOfWeek.TUE, DayOfWeek.WED, DayOfWeek.THU, DayOfWeek.FRI];
// Two slots per class, so a class shows up twice a week.
const SLOT_TIMES = [
  ['17:00', '18:00'],
  ['19:00', '20:00'],
] as const;
// Four past weeks to mark attendance against, the current one, and one ahead for the
// customer portal to RSVP to.
const WEEK_OFFSETS = [-4, -3, -2, -1, 0, 1] as const;
// The dashboard's default window is the last six months; three keeps the chart from
// reading as a single bar.
const FEE_MONTH_OFFSETS = [2, 1, 0] as const;

interface GeneratedUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

interface GeneratedClass {
  id: string;
  name: string;
  perMonth: boolean;
  amount: Prisma.Decimal;
}

const at = <T>(pool: readonly T[], index: number): T => pool[index % pool.length] as T;

export function slugifyTenantName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function seedData(prisma: PrismaClient, opts: SeedDataOptions): Promise<void> {
  // Guards before the first query, so a rejected run leaves no partial state. Every
  // account this creates shares one password, which is why production is fenced off.
  // Never echo the rejected value — this can reach CI logs.
  if (!shouldSeedDemoData(process.env.NODE_ENV)) {
    throw new Error(
      'Refusing to generate demo data with NODE_ENV=production: every generated account shares one known password.',
    );
  }
  const password = process.env.SEED_DATA_PASSWORD;
  if (!password) {
    throw new Error('SEED_DATA_PASSWORD must be set to generate demo data.');
  }
  if (looksLikePlaceholder(password)) {
    throw new Error('SEED_DATA_PASSWORD is still a placeholder; set a real password first.');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_DATA_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters; refusing to seed.`,
    );
  }

  const size = SEED_SIZES[opts.size];
  // Timestamp for greppability, random suffix so two runs in the same millisecond differ.
  const runTag = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const now = new Date();

  const tenant = opts.createTenant
    ? await createTenant(prisma, opts.createTenant)
    : await findTenant(prisma, opts.fill as string);
  const tenantId = tenant.id;
  const emailFor = (role: string, n?: number): string =>
    `${role}${n === undefined ? '' : `-${n}`}.${runTag}@${tenant.slug}.pulsedesk.local`;

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // --- Locations. Upserted on tenantId_name: a second run works in the same halls. ---
  const locations: { id: string }[] = [];
  for (let i = 0; i < size.locations; i += 1) {
    const name = at(LOCATION_NAMES, i);
    locations.push(
      await prisma.location.upsert({
        where: { tenantId_name: { tenantId, name } },
        update: { isActive: true },
        create: { tenantId, name, address: `${i + 1} Demo Street` },
      }),
    );
  }
  const everyLocation = locations.map((location) => ({ id: location.id }));

  // --- Users. New every run (the tag is in the email), so plain create. ---
  const admin = await createUser(prisma, {
    email: emailFor('admin'),
    passwordHash,
    firstName: 'Ada',
    lastName: 'Admin',
    tenantId,
    role: UserRole.ADMIN,
    locationIds: everyLocation,
  });

  const trainers: GeneratedUser[] = [];
  for (let i = 0; i < size.trainers; i += 1) {
    trainers.push(
      await createUser(prisma, {
        email: emailFor('trainer', i + 1),
        passwordHash,
        firstName: at(FIRST_NAMES, i + 4),
        lastName: at(LAST_NAMES, i * 3 + 1),
        tenantId,
        role: UserRole.EMPLOYEE,
        // TKT-0054: staff read only their assigned locations, so a trainer without one
        // signs in to empty lists.
        locationIds: [{ id: at(locations, i).id }],
      }),
    );
  }

  const customers: GeneratedUser[] = [];
  for (let i = 0; i < size.customers; i += 1) {
    customers.push(
      await createUser(prisma, {
        email: emailFor('parent', i + 1),
        passwordHash,
        firstName: at(FIRST_NAMES, i + 7),
        lastName: at(LAST_NAMES, i * 5 + 2),
        tenantId,
        role: UserRole.CUSTOMER,
        // LocationScopeService returns null for CUSTOMER — an assignment would be noise.
        locationIds: [],
      }),
    );
  }

  // --- Classes. Alternating billing mode; nothing at the DB level pairs the price
  // column with the mode, so this does. Upserted so a second run reuses them. ---
  const classes: GeneratedClass[] = [];
  for (let i = 0; i < size.classes; i += 1) {
    const name = at(CLASS_NAMES, i);
    const perMonth = i % 2 === 0;
    const amount = new Prisma.Decimal(perMonth ? 60 + i * 10 : 12 + i);
    const trainerConnect = { connect: [{ id: at(trainers, i).id }] };
    const locationConnect = { connect: [{ id: at(locations, i).id }] };
    const row = await prisma.class.upsert({
      where: { tenantId_name: { tenantId, name } },
      update: { isActive: true, trainers: trainerConnect, locations: locationConnect },
      create: {
        tenantId,
        name,
        description: `${name} — generated by seed:data`,
        billingMode: perMonth ? BillingMode.PER_MONTH : BillingMode.PER_SESSION,
        ...(perMonth ? { monthlyAmount: amount } : { sessionPrice: amount }),
        trainers: trainerConnect,
        locations: locationConnect,
      },
    });
    classes.push({ id: row.id, name, perMonth, amount });
  }

  // --- Trainees. Every third is a minor and gets contacts: the PRD under-18 rule is
  // enforced by POST /api/trainees, which a direct insert bypasses, so it is enforced
  // here instead. ---
  const rosters = new Map<string, { id: string }[]>();
  let linkedAccounts = 0;
  for (let i = 0; i < size.trainees; i += 1) {
    const cls = at(classes, i);
    const isMinor = i % 3 === 0;
    const lastName = at(LAST_NAMES, i * 5);
    // A CUSTOMER account may guard minors and own at most one trainee row
    // (Trainee.userId is @unique), so the link stops at the number of customers.
    const linkTo = !isMinor && linkedAccounts < customers.length ? at(customers, linkedAccounts) : undefined;
    if (linkTo) linkedAccounts += 1;

    const trainee = await prisma.trainee.create({
      data: {
        tenantId,
        firstName: at(FIRST_NAMES, i),
        lastName,
        dateOfBirth: birthDate(isMinor ? 8 + (i % 9) : 18 + (i % 30)),
        phone: PHONE,
        ...(isMinor ? {} : { email: emailFor('trainee', i + 1) }),
        classes: { connect: [{ id: cls.id }] },
        locations: { connect: [{ id: at(locations, i).id }] },
        ...(isMinor
          ? {
              guardians: { connect: [{ id: at(customers, i).id }] },
              contacts: { create: buildContacts(tenantId, i, lastName) },
            }
          : {}),
        // `userId`, not `user: { connect }`: passing tenantId as a scalar puts this on
        // Prisma's Unchecked create input, where the owning side of a to-one relation is
        // the FK column.
        ...(linkTo ? { userId: linkTo.id } : {}),
      },
    });

    const roster = rosters.get(cls.id) ?? [];
    roster.push({ id: trainee.id });
    rosters.set(cls.id, roster);
  }

  // --- Weekly slots. Deduped on (classId, locationId, dayOfWeek, startTime), mirroring
  // ClassSchedulesService.generateSessions' dedupKey. ---
  interface Slot {
    cls: GeneratedClass;
    locationId: string;
    trainerId: string;
    dayOffset: number;
    startTime: string;
    endTime: string;
  }
  const slots: Slot[] = [];
  for (const [classIndex, cls] of classes.entries()) {
    for (const [slotIndex, [startTime, endTime]] of SLOT_TIMES.entries()) {
      const dayOffset = (classIndex + slotIndex * 2) % WEEKDAYS.length;
      const locationId = at(locations, classIndex).id;
      const dayOfWeek = at(WEEKDAYS, dayOffset);
      const existing = await prisma.classSchedule.findFirst({
        where: { tenantId, classId: cls.id, locationId, dayOfWeek, startTime },
      });
      if (!existing) {
        await prisma.classSchedule.create({
          data: { tenantId, classId: cls.id, locationId, dayOfWeek, startTime, endTime },
        });
      }
      slots.push({
        cls,
        locationId,
        trainerId: at(trainers, classIndex).id,
        dayOffset,
        startTime,
        endTime,
      });
    }
  }

  // --- Sessions + attendance. Sessions are reused when present; attendance is written
  // only for the trainees this run created, so @@unique([sessionId, traineeId]) can
  // never collide. One row per enrolled trainee, mirroring sessions.service.ts. ---
  const thisMonday = mondayOf(now);
  const latestPastSession = new Map<string, { id: string; startsAt: Date; endsAt: Date }>();
  let sessionCount = 0;
  let attendanceCount = 0;

  for (const [weekIndex, weekOffset] of WEEK_OFFSETS.entries()) {
    const weekMonday = addDays(thisMonday, weekOffset * 7);
    for (const slot of slots) {
      const day = addDays(weekMonday, slot.dayOffset);
      const startsAt = atTime(day, slot.startTime);
      const endsAt = atTime(day, slot.endTime);
      const isPast = endsAt < now;

      const existing = await prisma.session.findFirst({
        where: { tenantId, classId: slot.cls.id, locationId: slot.locationId, startsAt },
      });
      const session =
        existing ??
        (await prisma.session.create({
          data: {
            tenantId,
            classId: slot.cls.id,
            locationId: slot.locationId,
            startsAt,
            endsAt,
            status: isPast ? SessionStatus.COMPLETED : SessionStatus.SCHEDULED,
            trainers: { connect: [{ id: slot.trainerId }] },
          },
        }));
      if (!existing) sessionCount += 1;
      if (isPast) latestPastSession.set(slot.cls.id, { id: session.id, startsAt, endsAt });

      const roster = rosters.get(slot.cls.id) ?? [];
      if (roster.length === 0) continue;
      const trainer = trainers.find((candidate) => candidate.id === slot.trainerId) ?? admin;
      await prisma.attendance.createMany({
        data: roster.map((trainee, traineeIndex) =>
          isPast
            ? {
                tenantId,
                sessionId: session.id,
                traineeId: trainee.id,
                status: at(MARKED_STATUSES, weekIndex + traineeIndex),
                markedAt: endsAt,
                markedById: trainer.id,
                markedByEmailSnapshot: trainer.email,
                markedByNameSnapshot: fullName(trainer),
              }
            : {
                tenantId,
                sessionId: session.id,
                traineeId: trainee.id,
                status: AttendanceStatus.PENDING,
                traineeRsvp:
                  traineeIndex % 4 === 0
                    ? AttendanceRsvp.CONFIRMED
                    : traineeIndex % 4 === 1
                      ? AttendanceRsvp.DECLINED
                      : null,
              },
        ),
      });
      attendanceCount += roster.length;
    }
  }

  // --- Fees. PER_MONTH classes bill three months; PER_SESSION classes bill the latest
  // completed session. Status cycles PAID / PARTIAL / UNPAID, and the ledger never
  // exceeds the amount: FeeStatus cannot express "more than enough" and FeesService
  // compares with eq, not gte. ---
  const recorder = trainers[0] ?? admin;
  let feeIndex = 0;
  let feeCount = 0;

  for (const cls of classes) {
    const roster = rosters.get(cls.id) ?? [];
    if (roster.length === 0) continue;

    if (cls.perMonth) {
      for (const monthsAgo of FEE_MONTH_OFFSETS) {
        const periodStart = monthStartUtc(monthsAgo);
        const periodEnd = monthEndUtc(monthsAgo);
        for (const trainee of roster) {
          await createFee(prisma, {
            tenantId,
            classId: cls.id,
            traineeId: trainee.id,
            periodStart,
            periodEnd,
            amount: cls.amount,
            cycle: feeIndex += 1,
            recorder,
          });
          feeCount += 1;
        }
      }
      continue;
    }

    const session = latestPastSession.get(cls.id);
    if (!session) continue;
    for (const trainee of roster) {
      await createFee(prisma, {
        tenantId,
        classId: cls.id,
        traineeId: trainee.id,
        sessionId: session.id,
        periodStart: session.startsAt,
        periodEnd: session.endsAt,
        amount: cls.amount,
        cycle: feeIndex += 1,
        recorder,
      });
      feeCount += 1;
    }
  }

  /* eslint-disable no-console */
  console.log(`\n✔ seed:data complete — run tag ${runTag}`);
  console.log('  Club:        ', tenant.name, `(--fill ${tenant.slug})`);
  console.log('  Size:        ', opts.size);
  console.log('  Admin:       ', admin.email, '(password from SEED_DATA_PASSWORD env)');
  console.log('  Trainers:    ', trainers.length, '· Customers:', customers.length);
  console.log('  Trainees:    ', size.trainees, `· Classes: ${classes.length} (reused if present)`);
  console.log('  Sessions:    ', sessionCount, 'new ·', attendanceCount, 'attendance rows');
  console.log('  Fees:        ', feeCount);
  /* eslint-enable no-console */
}

async function createTenant(
  prisma: PrismaClient,
  name: string,
): Promise<{ id: string; name: string; slug: string }> {
  const slug = slugifyTenantName(name);
  if (!slug) {
    throw new Error(`"${name}" contains no letters or digits to build a slug from.`);
  }
  const clash = await prisma.tenant.findUnique({ where: { slug } });
  if (clash) {
    throw new Error(`Tenant "${slug}" already exists; use --fill ${slug} to add data to it.`);
  }
  return prisma.tenant.create({ data: { name, slug, isActive: true } });
}

async function findTenant(
  prisma: PrismaClient,
  target: string,
): Promise<{ id: string; name: string; slug: string }> {
  const bySlug = await prisma.tenant.findUnique({ where: { slug: target } });
  const tenant = bySlug ?? (await prisma.tenant.findUnique({ where: { id: target } }));
  if (!tenant) {
    throw new Error(`No tenant matches "${target}" by slug or id.`);
  }
  return tenant;
}

async function createUser(
  prisma: PrismaClient,
  spec: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    role: UserRole;
    locationIds: { id: string }[];
  },
): Promise<GeneratedUser> {
  return prisma.user.create({
    data: {
      email: spec.email,
      passwordHash: spec.passwordHash,
      firstName: spec.firstName,
      lastName: spec.lastName,
      memberships: { create: { tenantId: spec.tenantId, role: spec.role } },
      ...(spec.locationIds.length > 0 ? { locations: { connect: spec.locationIds } } : {}),
    },
  });
}

function buildContacts(
  tenantId: string,
  index: number,
  lastName: string,
): {
  tenantId: string;
  firstName: string;
  lastName: string;
  relationship: ContactRelationship;
  phone: string;
  isPrimary: boolean;
}[] {
  const count = index % 2 === 0 ? 1 : 2;
  return Array.from({ length: count }, (_unused, contactIndex) => ({
    tenantId,
    firstName: at(FIRST_NAMES, index + contactIndex + 3),
    lastName,
    relationship: contactIndex === 0 ? ContactRelationship.PARENT : ContactRelationship.GUARDIAN,
    phone: PHONE,
    isPrimary: contactIndex === 0,
  }));
}

async function createFee(
  prisma: PrismaClient,
  spec: {
    tenantId: string;
    classId: string;
    traineeId: string;
    sessionId?: string;
    periodStart: Date;
    periodEnd: Date;
    amount: Prisma.Decimal;
    cycle: number;
    recorder: GeneratedUser;
  },
): Promise<void> {
  const cycle = spec.cycle % 3;
  const paid =
    cycle === 0 ? spec.amount : cycle === 1 ? spec.amount.div(2).toDecimalPlaces(2) : null;
  const status =
    cycle === 0 ? FeeStatus.PAID : cycle === 1 ? FeeStatus.PARTIAL : FeeStatus.UNPAID;

  await prisma.fee.create({
    data: {
      tenantId: spec.tenantId,
      classId: spec.classId,
      traineeId: spec.traineeId,
      ...(spec.sessionId ? { sessionId: spec.sessionId } : {}),
      periodStart: spec.periodStart,
      periodEnd: spec.periodEnd,
      amount: spec.amount,
      // FeesService recomputes status on the HTTP path only, so a direct insert owns it.
      status,
      ...(paid
        ? {
            payments: {
              create: [
                {
                  tenantId: spec.tenantId,
                  amount: paid,
                  paidAt: spec.periodStart,
                  method: 'cash',
                  recordedById: spec.recorder.id,
                  recordedByEmailSnapshot: spec.recorder.email,
                  recordedByNameSnapshot: fullName(spec.recorder),
                },
              ],
            },
          }
        : {}),
    },
  });
}

function fullName(user: GeneratedUser): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ');
}
