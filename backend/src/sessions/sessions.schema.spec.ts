import { BillingMode, SessionStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  PaginatedSessionSchema,
  SessionDetailSchema,
  SessionSchema,
  SessionStatusSchema,
} from './sessions.schema';

// Unlike the HH:MM wall-clock strings in class-schedules, these are real instants. The wire
// form must stay exactly what JSON.stringify produces today (Date.prototype.toJSON →
// toISOString), because dashboard/page.tsx counts this week's sessions with
// `new Date(r.startsAt)` — a changed format would miscount silently rather than throw.

const runtimeSession = {
  id: 's1',
  tenantId: 't1',
  classId: 'c1',
  locationId: 'l1',
  startsAt: new Date('2026-06-01T18:00:00.000Z'),
  endsAt: new Date('2026-06-01T19:30:00.000Z'),
  status: SessionStatus.SCHEDULED,
  notes: null,
  createdAt: new Date('2026-05-01T09:00:00.000Z'),
  updatedAt: new Date('2026-05-02T09:00:00.000Z'),
};

const runtimeDetail = {
  ...runtimeSession,
  class: {
    id: 'c1',
    name: 'Tennis',
    billingMode: BillingMode.PER_SESSION,
    capacity: null,
    waitlistMode: 'NONE',
  },
  location: { id: 'l1', name: 'Main' },
  trainers: [{ id: 'u1', firstName: 'Ivan', lastName: null, email: 'ivan@test.local' }],
};

describe('SessionSchema', () => {
  it('transforms every instant to the exact ISO string JSON.stringify produces', () => {
    const parsed = SessionSchema.parse(runtimeSession);
    expect(parsed.startsAt).toBe('2026-06-01T18:00:00.000Z');
    expect(parsed.endsAt).toBe('2026-06-01T19:30:00.000Z');
    expect(parsed.createdAt).toBe('2026-05-01T09:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-05-02T09:00:00.000Z');
    // The literal above is the contract; this proves it is also what the wire produced before.
    expect(parsed.startsAt).toBe(JSON.parse(JSON.stringify(runtimeSession)).startsAt);
  });

  it('rejects a session whose instant arrived as a string', () => {
    // A service that stopped returning a Date would be a real drift, not a serialization detail.
    expect(
      SessionSchema.safeParse({ ...runtimeSession, startsAt: '2026-06-01T18:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('keeps notes nullable', () => {
    expect(SessionSchema.parse(runtimeSession).notes).toBeNull();
    expect(SessionSchema.parse({ ...runtimeSession, notes: 'Bring rackets' }).notes).toBe(
      'Bring rackets',
    );
  });
});

describe('SessionStatusSchema', () => {
  it('builds SessionStatus from the Prisma enum and rejects an unknown member', () => {
    expect(SessionStatusSchema.options).toEqual(Object.values(SessionStatus));
    expect(SessionStatusSchema.parse('CANCELLED')).toBe('CANCELLED');
    // Adding a member to schema.prisma without regenerating must not silently pass here.
    expect(SessionStatusSchema.safeParse('POSTPONED').success).toBe(false);
  });
});

describe('SessionDetailSchema', () => {
  it('narrows the detail relations to exactly the selected columns', () => {
    const parsed = SessionDetailSchema.parse({
      ...runtimeDetail,
      // Anything the select does not name must be stripped, whatever a future include adds.
      class: { ...runtimeDetail.class, description: 'leaked', tenantId: 't1' },
      location: { ...runtimeDetail.location, address: 'leaked', isActive: true },
      trainers: [{ ...runtimeDetail.trainers[0], passwordHash: 'leaked' }],
    });
    // TKT-0103 (approved TCR #3): `capacity` joined the select deliberately — the pin stays exact.
    // TKT-0112 (named in the approved plan): `waitlistMode` joined it too.
    expect(Object.keys(parsed.class).sort()).toEqual([
      'billingMode',
      'capacity',
      'id',
      'name',
      'waitlistMode',
    ]);
    expect(Object.keys(parsed.location).sort()).toEqual(['id', 'name']);
    expect(Object.keys(parsed.trainers[0]!).sort()).toEqual([
      'email',
      'firstName',
      'id',
      'lastName',
    ]);
  });

  it('builds the class billing mode from the Prisma enum', () => {
    expect(
      SessionDetailSchema.safeParse({
        ...runtimeDetail,
        class: { ...runtimeDetail.class, billingMode: 'PER_FORTNIGHT' },
      }).success,
    ).toBe(false);
  });

  it('keeps a trainer with no first or last name', () => {
    const parsed = SessionDetailSchema.parse({
      ...runtimeDetail,
      trainers: [{ id: 'u2', firstName: null, lastName: null, email: 'x@test.local' }],
    });
    expect(parsed.trainers[0]!.firstName).toBeNull();
  });
});

describe('PaginatedSessionSchema', () => {
  it('uses the shared pagination envelope', () => {
    const parsed = PaginatedSessionSchema.parse({
      items: [runtimeSession],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
      'totalPages',
    ]);
    expect(parsed.items[0]!.startsAt).toBe('2026-06-01T18:00:00.000Z');
  });
});
