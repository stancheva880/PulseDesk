import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PaymentSchema } from './payments.schema';

const runtimePayment = {
  id: 'p1',
  tenantId: 't1',
  feeId: 'f1',
  amount: new Prisma.Decimal('49.99'),
  paidAt: new Date('2026-08-05T00:00:00.000Z'),
  method: 'cash',
  notes: null,
  recordedById: 'u1',
  recordedByEmailSnapshot: 'admin@test.local',
  recordedByNameSnapshot: 'Admin One',
  createdAt: new Date('2026-08-05T09:00:00.000Z'),
};

describe('PaymentSchema', () => {
  it('declares the payment amount as a string', () => {
    const payment = PaymentSchema.parse(runtimePayment);
    expect(payment.amount).toBe('49.99');
    expect(typeof payment.amount).toBe('string');
  });

  it('transforms paidAt and createdAt to ISO strings', () => {
    const payment = PaymentSchema.parse(runtimePayment);
    expect(payment.paidAt).toBe('2026-08-05T00:00:00.000Z');
    expect(payment.createdAt).toBe('2026-08-05T09:00:00.000Z');
  });

  it('allows the audit snapshot fields to be null', () => {
    const payment = PaymentSchema.parse({
      ...runtimePayment,
      method: null,
      recordedById: null,
      recordedByEmailSnapshot: null,
      recordedByNameSnapshot: null,
    });
    expect(payment.recordedById).toBeNull();
    expect(payment.recordedByEmailSnapshot).toBeNull();
  });

  it('rejects a payment that lost its amount', () => {
    const { amount: _dropped, ...withoutAmount } = runtimePayment;
    expect(PaymentSchema.safeParse(withoutAmount).success).toBe(false);
  });
});
