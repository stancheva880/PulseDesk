import { FeeStatus, Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  CustomerFeeEntrySchema,
  FeeDetailSchema,
  FeeRowSchema,
  FeeSchema,
  FeeStatusSchema,
  GenerateResultSchema,
  PaginatedFeeRowSchema,
} from './fees.schema';

// Money is the highest-consequence module in the epic: every amount is a Prisma Decimal that
// must reach the wire as a string. A z.number() on an amount would turn "120.00" into 120 for
// every caller, and both the fees table and the chart read the string form.

const runtimeFee = {
  id: 'f1',
  tenantId: 't1',
  classId: 'c1',
  traineeId: 'tr1',
  sessionId: null,
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-08-31T00:00:00.000Z'),
  amount: new Prisma.Decimal('120.00'),
  status: FeeStatus.UNPAID,
  notes: null,
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  updatedAt: new Date('2026-08-02T09:00:00.000Z'),
};

const runtimePayment = {
  id: 'p1',
  tenantId: 't1',
  feeId: 'f1',
  amount: new Prisma.Decimal('50.00'),
  paidAt: new Date('2026-08-05T00:00:00.000Z'),
  method: 'cash',
  notes: null,
  recordedById: 'u1',
  recordedByEmailSnapshot: 'admin@test.local',
  recordedByNameSnapshot: 'Admin One',
  createdAt: new Date('2026-08-05T09:00:00.000Z'),
};

describe('FeeSchema', () => {
  it('declares every amount as a string, never a number', () => {
    const fee = FeeSchema.parse(runtimeFee);
    expect(fee.amount).toBe('120');
    expect(typeof fee.amount).toBe('string');

    const row = FeeRowSchema.parse({ ...runtimeFee, paid: new Prisma.Decimal('50.00') });
    expect(row.paid).toBe('50');
    expect(typeof row.paid).toBe('string');

    const detail = FeeDetailSchema.parse({
      ...runtimeFee,
      class: { id: 'c1', name: 'Tennis', billingMode: 'PER_MONTH' },
      trainee: { id: 'tr1', firstName: 'Ivan', lastName: 'Petrov' },
      payments: [runtimePayment],
    });
    expect(detail.payments[0]!.amount).toBe('50');
    expect(typeof detail.payments[0]!.amount).toBe('string');
  });

  it('rejects a fee that lost its amount', () => {
    const { amount: _dropped, ...withoutAmount } = runtimeFee;
    expect(FeeSchema.safeParse(withoutAmount).success).toBe(false);
  });

  it('keeps sessionId, which generateSessionFees populates', () => {
    expect(FeeSchema.parse({ ...runtimeFee, sessionId: 's1' }).sessionId).toBe('s1');
    expect(FeeSchema.parse(runtimeFee).sessionId).toBeNull();
  });

  it('transforms every DateTime column to an ISO string', () => {
    const fee = FeeSchema.parse(runtimeFee);
    expect(fee.periodStart).toBe('2026-08-01T00:00:00.000Z');
    expect(fee.periodEnd).toBe('2026-08-31T00:00:00.000Z');
    expect(fee.createdAt).toBe('2026-08-01T09:00:00.000Z');
    expect(fee.updatedAt).toBe('2026-08-02T09:00:00.000Z');
  });
});

describe('FeeStatusSchema', () => {
  it('builds FeeStatus from the Prisma enum and rejects an unknown member', () => {
    expect(FeeStatusSchema.options).toEqual(Object.values(FeeStatus));
    expect(FeeStatusSchema.parse('PARTIAL')).toBe('PARTIAL');
    // Adding WAIVED to schema.prisma without regenerating must not silently pass here.
    expect(FeeStatusSchema.safeParse('WAIVED').success).toBe(false);
  });
});

describe('list and generate shapes', () => {
  it('uses the shared pagination envelope for the fee list', () => {
    const parsed = PaginatedFeeRowSchema.parse({
      items: [{ ...runtimeFee, paid: new Prisma.Decimal(0) }],
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
    // A fee with no payments aggregates to zero, and stays a string.
    expect(parsed.items[0]!.paid).toBe('0');
  });

  it('declares the generate result as created and skipped', () => {
    expect(GenerateResultSchema.parse({ created: 3, skipped: 1 })).toEqual({
      created: 3,
      skipped: 1,
    });
    expect(GenerateResultSchema.safeParse({ created: 3 }).success).toBe(false);
  });

  it('narrows the customer entry class to id and name', () => {
    const parsed = CustomerFeeEntrySchema.parse({
      ...runtimeFee,
      class: { id: 'c1', name: 'Tennis', billingMode: 'PER_MONTH' },
      trainee: { id: 'tr1', firstName: 'Ivan', lastName: 'Petrov' },
      payments: [],
    });
    expect(Object.keys(parsed.class).sort()).toEqual(['id', 'name']);
  });
});
