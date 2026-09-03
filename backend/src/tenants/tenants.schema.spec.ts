import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  TenantPaymentDetailsSchema,
  TenantSummaryListSchema,
  TenantSummarySchema,
} from './tenants.schema';

// GET /tenants fills the SUPER_ADMIN tenant selector and answers before any tenant is active,
// so its shape is what TKT-0039's select-tenant panel renders against.

const runtimeTenant = {
  id: 't1',
  slug: 'ace-tennis',
  name: 'Ace Tennis Club',
  isActive: true,
};

describe('TenantSummarySchema', () => {
  it('declares exactly the four selected tenant columns', () => {
    const published = Object.keys(
      (z.toJSONSchema(TenantSummarySchema, { io: 'output' }).properties ?? {}) as Record<
        string,
        unknown
      >,
    );
    expect(published.sort()).toEqual(['id', 'isActive', 'name', 'slug']);
  });

  it('strips a column the select does not name', () => {
    const parsed = TenantSummarySchema.parse({
      ...runtimeTenant,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(Object.keys(parsed).sort()).toEqual(['id', 'isActive', 'name', 'slug']);
  });

  it('rejects a tenant that lost its slug', () => {
    const { slug: _dropped, ...withoutSlug } = runtimeTenant;
    expect(TenantSummarySchema.safeParse(withoutSlug).success).toBe(false);
  });
});

describe('TenantSummaryListSchema', () => {
  it('stays a plain array, not a pagination envelope', () => {
    const parsed = TenantSummaryListSchema.parse([runtimeTenant]);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]!.slug).toBe('ace-tennis');
  });
});

describe('TenantPaymentDetailsSchema', () => {
  it('declares exactly the five payment fields, all nullable', () => {
    const published = Object.keys(
      (z.toJSONSchema(TenantPaymentDetailsSchema, { io: 'output' }).properties ?? {}) as Record<
        string,
        unknown
      >,
    );
    expect(published.sort()).toEqual([
      'bankAccountHolder',
      'bankIban',
      'cashNote',
      'myposLink',
      'revolutHandle',
    ]);
    const parsed = TenantPaymentDetailsSchema.parse({
      bankIban: null,
      bankAccountHolder: null,
      revolutHandle: '@club',
      myposLink: null,
      cashNote: null,
    });
    expect(parsed.bankIban).toBeNull();
    expect(parsed.revolutHandle).toBe('@club');
  });
});
