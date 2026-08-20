import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { ClassDetailSchema, ClassRowSchema } from './classes.schema';

// The schemas parse *runtime* values — Prisma Decimal, JS Date — and transform them to the
// wire shape, so z.output<typeof Schema> is what the client actually receives.

const runtimeRow = {
  id: 'c1',
  tenantId: 't1',
  name: 'Beginner Tennis',
  description: null,
  billingMode: 'PER_MONTH',
  monthlyAmount: new Prisma.Decimal('80.00'),
  sessionPrice: null,
  isActive: true,
  createdAt: new Date('2026-08-17T10:00:00.000Z'),
  updatedAt: new Date('2026-08-17T11:30:00.000Z'),
};

const runtimeDetail = {
  ...runtimeRow,
  locations: [{ id: 'l1', name: 'Main Hall' }],
  trainers: [{ id: 'u1', firstName: 'Ana', lastName: null, email: 'ana@test.local' }],
  trainees: [{ id: 'tr1', firstName: 'Ivan', lastName: 'Petrov' }],
};

describe('ClassRowSchema', () => {
  it('transforms Decimal to string and Date to an ISO string', () => {
    const parsed = ClassRowSchema.parse(runtimeRow);
    expect(parsed.monthlyAmount).toBe('80');
    expect(parsed.sessionPrice).toBeNull();
    expect(parsed.createdAt).toBe('2026-08-17T10:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-08-17T11:30:00.000Z');
  });

  it('rejects a row that lost a column', () => {
    const { isActive: _dropped, ...withoutIsActive } = runtimeRow;
    const result = ClassRowSchema.safeParse(withoutIsActive);
    expect(result.success).toBe(false);
  });
});

describe('ClassDetailSchema', () => {
  it('keeps the relation shapes GET /classes/:id actually selects', () => {
    const parsed = ClassDetailSchema.parse(runtimeDetail);
    expect(parsed.trainers[0]).toEqual({
      id: 'u1',
      firstName: 'Ana',
      lastName: null,
      email: 'ana@test.local',
    });
    expect(parsed.trainees[0]).toEqual({ id: 'tr1', firstName: 'Ivan', lastName: 'Petrov' });
  });

  it('locations accepts only id and name', () => {
    // The original defect: locations was typed as a full Location[] while the select is
    // { id, name }. Anything beyond the two columns is not part of the contract.
    const parsed = ClassDetailSchema.parse({
      ...runtimeDetail,
      locations: [{ id: 'l1', name: 'Main Hall', address: '12 Any St', isActive: true }],
    });
    expect(Object.keys(parsed.locations[0]!)).toEqual(['id', 'name']);
  });

  it('fails when a location loses its name', () => {
    const result = ClassDetailSchema.safeParse({
      ...runtimeDetail,
      locations: [{ id: 'l1' }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toContain('locations.0.name');
  });
});
