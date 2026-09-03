import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LocationRefSchema,
  LocationSchema,
  PaginatedLocationSchema,
} from './locations.schema';

// The whole point of this module in the epic: a Location is seven fields when these routes
// return it, and two when another module embeds it. Confusing the two is the ClassDetail.locations
// defect that started PRD-0008, so the two shapes are named separately rather than one being the
// other narrowed at a call site.

const runtimeLocation = {
  id: 'l1',
  tenantId: 't1',
  name: 'Main Hall',
  address: '12 Vitosha Blvd',
  isActive: true,
  createdAt: new Date('2026-05-01T09:00:00.000Z'),
  updatedAt: new Date('2026-05-02T09:00:00.000Z'),
  // TKT-0128: where customers send money for this location — null when it inherits the
  // club's shared default instead (see Tenant's own payment-detail columns).
  bankIban: null,
  bankAccountHolder: null,
  revolutHandle: null,
  paypalEmail: null,
  cashNote: null,
};

const publishedNames = (schema: z.ZodType): string[] =>
  Object.keys(
    (z.toJSONSchema(schema, { io: 'output' }).properties ?? {}) as Record<string, unknown>,
  );

describe('LocationSchema', () => {
  it('declares exactly the twelve Location fields', () => {
    expect(publishedNames(LocationSchema).sort()).toEqual([
      'address',
      'bankAccountHolder',
      'bankIban',
      'cashNote',
      'createdAt',
      'id',
      'isActive',
      'name',
      'paypalEmail',
      'revolutHandle',
      'tenantId',
      'updatedAt',
    ]);
  });

  it('transforms both timestamps to ISO strings and keeps address nullable', () => {
    const parsed = LocationSchema.parse(runtimeLocation);
    expect(parsed.createdAt).toBe('2026-05-01T09:00:00.000Z');
    expect(parsed.updatedAt).toBe('2026-05-02T09:00:00.000Z');
    expect(parsed.address).toBe('12 Vitosha Blvd');

    // address is String? in schema.prisma — a location with no address is ordinary.
    expect(LocationSchema.parse({ ...runtimeLocation, address: null }).address).toBeNull();
  });

  it('rejects a row that lost a column', () => {
    const { address: _dropped, ...withoutAddress } = runtimeLocation;
    expect(LocationSchema.safeParse(withoutAddress).success).toBe(false);
  });
});

describe('LocationRefSchema', () => {
  it('declares the embedded reference as a separate two-column shape', () => {
    expect(publishedNames(LocationRefSchema).sort()).toEqual(['id', 'name']);
  });

  it('is not LocationSchema narrowed at the call site', () => {
    // Feeding a full row through the reference strips the five columns an embedder never selects,
    // which is what makes the two shapes impossible to confuse.
    const parsed = LocationRefSchema.parse(runtimeLocation);
    expect(Object.keys(parsed).sort()).toEqual(['id', 'name']);
    expect(parsed).not.toHaveProperty('address');
    expect(parsed).not.toHaveProperty('tenantId');
    expect(parsed).not.toHaveProperty('isActive');
  });
});

describe('PaginatedLocationSchema', () => {
  it('uses the shared pagination envelope', () => {
    const parsed = PaginatedLocationSchema.parse({
      items: [runtimeLocation],
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
    expect(parsed.items[0]!.createdAt).toBe('2026-05-01T09:00:00.000Z');
  });
});
