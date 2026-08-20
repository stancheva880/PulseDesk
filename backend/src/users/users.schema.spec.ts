import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CreatedUserSchema,
  PaginatedUserSummarySchema,
  UserSummarySchema,
} from './users.schema';

// The parse is an output allowlist, and that matters more here than anywhere else in the epic.
// USER_SELECT fetches `isSuperAdmin` and `memberships` on every route; `memberships` is
// { tenantId, role } for EVERY tenant the account belongs to, and only one destructuring line in
// toSummary() keeps it off the wire. These schemas strip it at the boundary instead.

const runtimeSummary = {
  id: 'u1',
  email: 'admin@test.local',
  firstName: 'Ivan',
  lastName: 'Petrov',
  phone: '0888 123 456',
  role: UserRole.ADMIN,
  tenantId: 't1',
  isActive: true,
  status: 'ACTIVE',
  locations: [{ id: 'l1', name: 'Main' }],
  createdAt: new Date('2026-05-01T09:00:00.000Z'),
  updatedAt: new Date('2026-05-02T09:00:00.000Z'),
};

const publishedNames = (schema: z.ZodType): string[] =>
  Object.keys(
    (z.toJSONSchema(schema, { io: 'output' }).properties ?? {}) as Record<string, unknown>,
  );

describe('UserSummarySchema', () => {
  it('declares exactly the twelve UserSummary fields', () => {
    expect(publishedNames(UserSummarySchema).sort()).toEqual([
      'createdAt',
      'email',
      'firstName',
      'id',
      'isActive',
      'lastName',
      'locations',
      // TKT-0083: optional free-text phone number, added to the published contract on purpose.
      'phone',
      'role',
      // TKT-0060: derived from isActive + whether a password is set. The hash stays undeclared.
      'status',
      'tenantId',
      'updatedAt',
    ]);
  });

  it('strips passwordHash, isSuperAdmin and memberships from a row that carries them', () => {
    // The query shape is wider than the response shape. If toSummary ever spread the row
    // directly, or USER_SELECT grew, this parse is what stops the leak.
    const parsed = UserSummarySchema.parse({
      ...runtimeSummary,
      passwordHash: '$2b$10$leaked',
      isSuperAdmin: false,
      memberships: [
        { tenantId: 't1', role: UserRole.ADMIN },
        { tenantId: 't2-another-club', role: UserRole.EMPLOYEE },
      ],
    });
    expect(parsed).not.toHaveProperty('passwordHash');
    expect(parsed).not.toHaveProperty('isSuperAdmin');
    expect(parsed).not.toHaveProperty('memberships');
    expect(JSON.stringify(parsed)).not.toContain('t2-another-club');
  });

  it('publishes no credential or cross-tenant field', () => {
    const published = JSON.stringify(z.toJSONSchema(UserSummarySchema, { io: 'output' }));
    for (const forbidden of ['passwordHash', 'isSuperAdmin', 'memberships', 'password']) {
      expect(published, `the users contract must not publish "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });

  it('narrows locations to exactly id and name', () => {
    const parsed = UserSummarySchema.parse({
      ...runtimeSummary,
      locations: [{ id: 'l1', name: 'Main', address: 'leaked', tenantId: 't1', isActive: true }],
    });
    expect(Object.keys(parsed.locations[0]!).sort()).toEqual(['id', 'name']);
  });

  it('accepts a SUPER_ADMIN row whose tenantId is null', () => {
    // Only SUPER_ADMIN may have tenantId = NULL, and it is legitimate rather than an error.
    const parsed = UserSummarySchema.parse({
      ...runtimeSummary,
      role: UserRole.SUPER_ADMIN,
      tenantId: null,
      locations: [],
    });
    expect(parsed.tenantId).toBeNull();
    expect(parsed.role).toBe('SUPER_ADMIN');
  });

  it('builds role from the Prisma enum and rejects an unknown member', () => {
    expect(UserSummarySchema.safeParse({ ...runtimeSummary, role: 'OWNER' }).success).toBe(false);
  });

  it('keeps firstName and lastName nullable', () => {
    const parsed = UserSummarySchema.parse({
      ...runtimeSummary,
      firstName: null,
      lastName: null,
    });
    expect(parsed.firstName).toBeNull();
  });
});

describe('CreatedUserSchema', () => {
  // notificationSent added to both payloads: the field is required now, so a payload without it
  // is not a valid create response any more. Mechanical — what this case asserts is
  // attachedExisting, and both of its assertions are unchanged.
  it('declares attachedExisting as optional so both create paths parse', () => {
    // Attach path: the flag is present and true (users.service.ts:187).
    const attached = CreatedUserSchema.parse({
      ...runtimeSummary,
      attachedExisting: true,
      notificationSent: true,
    });
    expect(attached.attachedExisting).toBe(true);

    // Plain-create path: the key is absent entirely (users.service.ts:219). Declaring the flag
    // required would fail every non-attach create.
    const created = CreatedUserSchema.parse({ ...runtimeSummary, notificationSent: true });
    expect(created).not.toHaveProperty('attachedExisting');
  });

  // The opposite rule to attachedExisting, and the reason the two cannot share a modifier: every
  // create path mails somebody and reports whether it left, so an omitted key is a bug rather
  // than a branch. It was optional only so TKT-0058 would not move the published contract.
  it('requires notificationSent, because no create path omits it', () => {
    expect(() => CreatedUserSchema.parse(runtimeSummary)).toThrow();
    expect(CreatedUserSchema.parse({ ...runtimeSummary, notificationSent: false }).notificationSent)
      .toBe(false);
  });
});

describe('PaginatedUserSummarySchema', () => {
  it('uses the shared pagination envelope', () => {
    const parsed = PaginatedUserSummarySchema.parse({
      items: [runtimeSummary],
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
