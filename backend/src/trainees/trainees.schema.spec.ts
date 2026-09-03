import { ContactRelationship } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  CustomerTraineeEntryListSchema,
  TraineeDetailSchema,
  TraineeSchema,
} from './trainees.schema';

// TraineeDetail carries five relation subsets — two narrowed by `select`, three included
// whole. Getting either kind wrong is the drift class this epic targets.

const runtimeTrainee = {
  id: 'tr1',
  tenantId: 't1',
  firstName: 'Ivan',
  lastName: 'Petrov',
  // A calendar day semantically, but a full DateTime column — the wire carries the timestamp.
  dateOfBirth: new Date('2012-05-04T00:00:00.000Z'),
  phone: '+359888123456',
  email: null,
  notes: null,
  isActive: true,
  userId: null,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-02T09:00:00.000Z'),
};

const runtimeContact = {
  id: 'cp1',
  tenantId: 't1',
  traineeId: 'tr1',
  firstName: 'Maria',
  lastName: 'Petrova',
  relationship: ContactRelationship.PARENT,
  phone: '+359888000111',
  email: 'maria@test.local',
  isPrimary: true,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-01T09:00:00.000Z'),
};

const runtimeLocation = {
  id: 'l1',
  tenantId: 't1',
  name: 'Main Hall',
  address: '12 Any St',
  isActive: true,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-01T09:00:00.000Z'),
  // TKT-0128: fixture completion for Location's new payment columns; no assertion changed.
  bankIban: null,
  bankAccountHolder: null,
  revolutHandle: null,
  myposLink: null,
  cashNote: null,
};

const runtimeClass = {
  id: 'c1',
  tenantId: 't1',
  name: 'Beginner Tennis',
  description: null,
  billingMode: 'PER_MONTH',
  monthlyAmount: null,
  sessionPrice: null,
  courseStart: null,
  courseEnd: null,
  coursePrice: null,
  capacity: null,
  waitlistMode: 'NONE',
  // TKT-0117: fixture completion for the new Class columns; no assertion changed.
  allowSelfBooking: false,
  bookingCutoffMin: null,
  isActive: true,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-01T09:00:00.000Z'),
};

const runtimeDetail = {
  ...runtimeTrainee,
  contacts: [runtimeContact],
  locations: [runtimeLocation],
  classes: [runtimeClass],
  guardians: [{ id: 'u1', firstName: 'Ana', lastName: null, email: 'ana@test.local' }],
  user: null,
};

describe('TraineeSchema', () => {
  it('transforms dateOfBirth and the audit timestamps to ISO strings', () => {
    const trainee = TraineeSchema.parse(runtimeTrainee);
    // The full timestamp, not a truncated YYYY-MM-DD — narrowing it would change the wire.
    expect(trainee.dateOfBirth).toBe('2012-05-04T00:00:00.000Z');
    expect(trainee.createdAt).toBe('2026-08-01T09:00:00.000Z');
    expect(trainee.updatedAt).toBe('2026-08-02T09:00:00.000Z');
  });

  it('keeps userId nullable for a trainee with no linked account', () => {
    expect(TraineeSchema.parse(runtimeTrainee).userId).toBeNull();
    expect(TraineeSchema.parse({ ...runtimeTrainee, userId: 'u9' }).userId).toBe('u9');
  });

  it('rejects a trainee that lost a column', () => {
    const { isActive: _dropped, ...withoutIsActive } = runtimeTrainee;
    expect(TraineeSchema.safeParse(withoutIsActive).success).toBe(false);
  });
});

describe('TraineeDetailSchema', () => {
  it('declares guardians as exactly the four selected columns', () => {
    const parsed = TraineeDetailSchema.parse(runtimeDetail);
    expect(Object.keys(parsed.guardians[0]!).sort()).toEqual([
      'email',
      'firstName',
      'id',
      'lastName',
    ]);
  });

  it('fails when the guardians select loses a column', () => {
    const result = TraineeDetailSchema.safeParse({
      ...runtimeDetail,
      guardians: [{ id: 'u1', firstName: 'Ana', lastName: null }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toContain(
      'guardians.0.email',
    );
  });

  it('declares the linked account as exactly id and email', () => {
    const parsed = TraineeDetailSchema.parse({
      ...runtimeDetail,
      user: { id: 'u2', email: 'trainee@test.local', firstName: 'Ignored' },
    });
    expect(Object.keys(parsed.user!).sort()).toEqual(['email', 'id']);
    expect(TraineeDetailSchema.parse(runtimeDetail).user).toBeNull();
  });

  it('keeps contacts, locations and classes as whole rows', () => {
    const parsed = TraineeDetailSchema.parse(runtimeDetail);
    // These relations are included with `true`, not narrowed by a select, so every column
    // stays part of the contract.
    expect(Object.keys(parsed.contacts[0]!).sort()).toEqual([
      'createdAt',
      'email',
      'firstName',
      'id',
      'isPrimary',
      'lastName',
      'phone',
      'relationship',
      'tenantId',
      'traineeId',
      'updatedAt',
    ]);
    expect(Object.keys(parsed.locations[0]!).sort()).toEqual([
      'address',
      'bankAccountHolder',
      'bankIban',
      'cashNote',
      'createdAt',
      'id',
      'isActive',
      'myposLink',
      'name',
      'revolutHandle',
      'tenantId',
      'updatedAt',
    ]);
    expect(parsed.classes[0]!.name).toBe('Beginner Tennis');
  });
});

describe('CustomerTraineeEntryListSchema', () => {
  it('declares each trainee with exactly its narrow row and its classes, empty or not', () => {
    const parsed = CustomerTraineeEntryListSchema.parse([
      {
        id: 'tr1',
        firstName: 'Kid',
        lastName: 'X',
        dateOfBirth: new Date('2015-05-04T00:00:00.000Z'),
        classes: [{ id: 'c1', name: 'Beginner Tennis', description: null }],
      },
      {
        id: 'tr2',
        firstName: 'Unenrolled',
        lastName: 'Kid',
        dateOfBirth: new Date('2016-05-04T00:00:00.000Z'),
        classes: [],
      },
    ]);
    expect(Object.keys(parsed[0]!).sort()).toEqual([
      'classes',
      'dateOfBirth',
      'firstName',
      'id',
      'lastName',
    ]);
    expect(parsed[0]!.dateOfBirth).toBe('2015-05-04T00:00:00.000Z');
    expect(parsed[1]!.classes).toEqual([]);
  });
});
