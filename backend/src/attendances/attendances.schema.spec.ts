import { AttendanceRsvp, AttendanceStatus, SessionStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  AttendanceRsvpSchema,
  AttendanceSchema,
  AttendanceStatusSchema,
  AttendanceWithTraineeSchema,
  BulkMarkResultSchema,
  CustomerSessionEntrySchema,
} from './attendances.schema';

// TKT-0038 widened the attendance list to carry the trainee's name because the page could not
// resolve names past the first 100 trainees. That subset had nothing protecting it; these
// schemas are what makes it impossible to lose again.
//
// Every audit column here is nullable on a fresh PENDING row, so the nullability is part of the
// contract rather than an accident of the first fixture that happened to be marked.

const unmarkedRow = {
  id: 'a1',
  tenantId: 't1',
  sessionId: 's1',
  traineeId: 'tr1',
  status: AttendanceStatus.PENDING,
  traineeRsvp: null,
  notes: null,
  markedAt: null,
  markedById: null,
  markedByEmailSnapshot: null,
  markedByNameSnapshot: null,
  createdAt: new Date('2026-05-01T09:00:00.000Z'),
  updatedAt: new Date('2026-05-01T09:00:00.000Z'),
};

const markedRow = {
  ...unmarkedRow,
  status: AttendanceStatus.PRESENT,
  traineeRsvp: AttendanceRsvp.CONFIRMED,
  notes: 'Arrived late',
  markedAt: new Date('2026-06-01T19:05:00.000Z'),
  markedById: 'u1',
  markedByEmailSnapshot: 'trainer@test.local',
  markedByNameSnapshot: 'Trainer One',
};

const trainee = { id: 'tr1', firstName: 'Ivan', lastName: 'Petrov' };

describe('AttendanceSchema', () => {
  it('keeps every audit column nullable on an unmarked row', () => {
    const parsed = AttendanceSchema.parse(unmarkedRow);
    expect(parsed.traineeRsvp).toBeNull();
    expect(parsed.markedAt).toBeNull();
    expect(parsed.markedById).toBeNull();
    expect(parsed.markedByEmailSnapshot).toBeNull();
    expect(parsed.markedByNameSnapshot).toBeNull();
    expect(parsed.notes).toBeNull();
  });

  it('transforms markedAt to an ISO string once the row is marked', () => {
    const parsed = AttendanceSchema.parse(markedRow);
    expect(parsed.markedAt).toBe('2026-06-01T19:05:00.000Z');
    expect(parsed.createdAt).toBe('2026-05-01T09:00:00.000Z');
  });
});

describe('the attendance enums', () => {
  it('builds AttendanceStatus from the Prisma enum and rejects an unknown member', () => {
    expect(AttendanceStatusSchema.options).toEqual(Object.values(AttendanceStatus));
    expect(AttendanceStatusSchema.parse('EXCUSED')).toBe('EXCUSED');
    expect(AttendanceStatusSchema.safeParse('LATE').success).toBe(false);
  });

  it('builds AttendanceRsvp from the Prisma enum and allows null', () => {
    expect(AttendanceRsvpSchema.options).toEqual(Object.values(AttendanceRsvp));
    // Reachable through three routes (rsvp, the session list, the customer portal), so it is
    // declared rather than deleted — PRD-0008 §9.
    expect(AttendanceSchema.parse(markedRow).traineeRsvp).toBe('CONFIRMED');
    expect(AttendanceSchema.parse(unmarkedRow).traineeRsvp).toBeNull();
    expect(AttendanceSchema.safeParse({ ...markedRow, traineeRsvp: 'MAYBE' }).success).toBe(false);
  });
});

describe('AttendanceWithTraineeSchema', () => {
  it('narrows the trainee subset to exactly the selected columns', () => {
    const parsed = AttendanceWithTraineeSchema.parse({
      ...markedRow,
      trainee: { ...trainee, dateOfBirth: new Date(), phone: '0888', tenantId: 't1' },
    });
    expect(Object.keys(parsed.trainee).sort()).toEqual(['firstName', 'id', 'lastName']);
  });

  it('keeps trainee non-nullable, matching the required relation', () => {
    // Attendance.trainee is required with onDelete: Cascade — it can never arrive null.
    expect(AttendanceWithTraineeSchema.safeParse({ ...markedRow, trainee: null }).success).toBe(
      false,
    );
    const { trainee: _dropped, ...withoutTrainee } = { ...markedRow, trainee };
    expect(AttendanceWithTraineeSchema.safeParse(withoutTrainee).success).toBe(false);
  });
});

describe('BulkMarkResultSchema', () => {
  it('declares the bulk-mark result as a single updated count', () => {
    expect(BulkMarkResultSchema.parse({ updated: 3 })).toEqual({ updated: 3 });
    expect(BulkMarkResultSchema.safeParse({}).success).toBe(false);
  });
});

describe('CustomerSessionEntrySchema', () => {
  it('describes a customer session as a session plus its class, location and own attendances', () => {
    const parsed = CustomerSessionEntrySchema.parse({
      id: 's1',
      tenantId: 't1',
      classId: 'c1',
      locationId: 'l1',
      startsAt: new Date('2026-06-01T18:00:00.000Z'),
      endsAt: new Date('2026-06-01T19:00:00.000Z'),
      status: SessionStatus.SCHEDULED,
      notes: null,
      createdAt: new Date('2026-05-01T09:00:00.000Z'),
      updatedAt: new Date('2026-05-01T09:00:00.000Z'),
      class: { id: 'c1', name: 'Tennis', billingMode: 'PER_SESSION' },
      location: { id: 'l1', name: 'Main', address: 'leaked' },
      attendances: [{ ...markedRow, trainee }],
    });
    // The session half comes from SessionSchema, so the instants transform identically.
    expect(parsed.startsAt).toBe('2026-06-01T18:00:00.000Z');
    // The portal gets the class name only — no billing mode.
    expect(Object.keys(parsed.class).sort()).toEqual(['id', 'name']);
    expect(Object.keys(parsed.location).sort()).toEqual(['id', 'name']);
    expect(parsed.attendances[0]!.trainee.firstName).toBe('Ivan');
    expect(parsed.attendances[0]!.markedAt).toBe('2026-06-01T19:05:00.000Z');
  });
});
