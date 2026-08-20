import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ForgotPasswordResponseSchema,
  LoginMembershipListSchema,
  LoginResponseSchema,
  RefreshResponseSchema,
  UserRoleSchema,
} from './auth.schema';

// These are the only schemas in the epic that sit next to credentials. `.parse()` strips every
// undeclared key, so each schema is an allowlist: a future `select *` on an auth path cannot
// leak a hash into a body. That also means a field named here is a field promised.

const membership = { tenantId: 't1', tenantName: 'Acme Club', role: UserRole.ADMIN };

/** Every property name any of these schemas publishes, at any depth. */
function publishedFieldNames(schema: z.ZodType): string[] {
  const names: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && value !== null && typeof value === 'object') {
        names.push(...Object.keys(value));
      }
      walk(value);
    }
  };
  walk(z.toJSONSchema(schema, { io: 'output' }));
  return names;
}

describe('UserRoleSchema', () => {
  it('builds UserRole from the Prisma enum and rejects an unknown member', () => {
    expect(UserRoleSchema.options).toEqual(Object.values(UserRole));
    expect(UserRoleSchema.parse('SUPER_ADMIN')).toBe('SUPER_ADMIN');
    expect(UserRoleSchema.safeParse('OWNER').success).toBe(false);
  });
});

describe('LoginResponseSchema', () => {
  it('declares the login response as an access token plus memberships', () => {
    const parsed = LoginResponseSchema.parse({
      accessToken: 'header.payload.signature',
      memberships: [membership],
    });
    expect(Object.keys(parsed).sort()).toEqual(['accessToken', 'memberships']);
    expect(parsed.memberships[0]).toEqual(membership);
  });

  it('keeps the refresh token out of the login response', () => {
    // The refresh token travels as a Set-Cookie (TKT-0036). Parsing strips it if a future
    // change ever puts it back in the body.
    const parsed = LoginResponseSchema.parse({
      accessToken: 'a.b.c',
      memberships: [],
      refreshToken: 'must-not-survive',
    }) as Record<string, unknown>;
    expect(parsed.refreshToken).toBeUndefined();
    expect(publishedFieldNames(LoginResponseSchema)).not.toContain('refreshToken');
  });
});

describe('RefreshResponseSchema', () => {
  // The route serves both callers: a browser authenticates with the cookie and gets the access
  // token alone; a body-authenticated caller gets the rotation handed back.
  it('keeps the rotated token for a body-authenticated refresh', () => {
    const parsed = RefreshResponseSchema.parse({
      accessToken: 'a.b.c',
      refreshToken: 'rotated-opaque-value',
    }) as Record<string, unknown>;
    expect(parsed.refreshToken).toBe('rotated-opaque-value');
  });

  it('adds no refresh token for a cookie refresh', () => {
    const parsed = RefreshResponseSchema.parse({ accessToken: 'a.b.c' }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed)).toEqual(['accessToken']);
    expect(parsed.refreshToken).toBeUndefined();
  });

  it('rejects a refresh response with no access token', () => {
    expect(RefreshResponseSchema.safeParse({ refreshToken: 'only-this' }).success).toBe(false);
  });
});

describe('ForgotPasswordResponseSchema', () => {
  it('declares only the generic message for forgot-password', () => {
    // Any extra field could differ between a hit and a miss, which would be an enumeration
    // oracle. One string, always the same.
    expect(publishedFieldNames(ForgotPasswordResponseSchema)).toEqual(['message']);
  });
});

describe('the auth module as a published contract', () => {
  it('names no password, hash or reset token in any auth schema', () => {
    const forbidden = [
      'password',
      'newPassword',
      'passwordHash',
      'tokenHash',
      'resetToken',
      'resetTokenHash',
      'familyId',
      'revokedAt',
    ];
    const schemas: Array<[string, z.ZodType]> = [
      ['LoginResponse', LoginResponseSchema],
      ['RefreshResponse', RefreshResponseSchema],
      ['ForgotPasswordResponse', ForgotPasswordResponseSchema],
      ['LoginMembershipList', LoginMembershipListSchema],
    ];
    for (const [name, schema] of schemas) {
      const published = publishedFieldNames(schema);
      for (const field of forbidden) {
        expect(published, `${name} must not publish "${field}"`).not.toContain(field);
      }
    }
  });
});

describe('LoginMembershipListSchema', () => {
  it('declares exactly tenantId, tenantName and role', () => {
    const parsed = LoginMembershipListSchema.parse([{ ...membership, extra: 'stripped' }]);
    expect(Object.keys(parsed[0]!).sort()).toEqual(['role', 'tenantId', 'tenantName']);
  });

  it('fails when a membership loses its tenantName', () => {
    const result = LoginMembershipListSchema.safeParse([
      { tenantId: 't1', role: UserRole.ADMIN },
    ]);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toContain('0.tenantName');
  });
});
