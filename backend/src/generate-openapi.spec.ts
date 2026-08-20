import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPENAPI_PATH, bootFailureMessage } from './generate-openapi';
import { responseSchemas } from './common/response-schema';

// The swagger CLI plugin is a tsc transformer, so DTO metadata only exists after
// `nest build`. Vitest compiles with swc and would see empty schemas — these tests
// therefore assert against the committed artifact, which is also what makes them a
// staleness guard: regenerate or go red.

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Approved TEST CHANGE REQUEST, 2026-08-19: 63 → 64 for
// GET /sessions/:sessionId/attendance-candidates (TKT-0071). Still exact, so the next
// unannounced route fails; the new route carries its own @ResponseSchema.
// Approved TEST CHANGE REQUEST, 2026-08-20: 64 → 65 for GET /fees/unbilled — the enrolled
// trainees a month has no fee for. Same terms: still exact, and the route carries its own
// @ResponseSchema (UnbilledFeeList).
const ROUTE_COUNT = 65;
const ENUM_COUNT = 8;
const ENUM_MEMBER_COUNT = 31;

interface OpenApiSpec {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
}

interface Operation {
  operationId?: string;
  responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
}

function loadSpec(): OpenApiSpec {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- module constant, not user input
  return JSON.parse(readFileSync(OPENAPI_PATH, 'utf8')) as OpenApiSpec;
}

/** The enums as `schema.prisma` declares them — the single source this spec compares against. */
function parsePrismaEnums(): Map<string, string[]> {
  const schemaPath = path.resolve(process.cwd(), 'prisma', 'schema.prisma');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- resolved from cwd, not user input
  const schema = readFileSync(schemaPath, 'utf8');
  const enums = new Map<string, string[]>();
  for (const match of schema.matchAll(/^enum\s+(\w+)\s*\{([^}]*)\}/gm)) {
    const [, name, body] = match;
    const members = body!
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean);
    enums.set(name!, members);
  }
  return enums;
}

/** Every `enum: [...]` in the document, wherever it sits — component schema or query parameter. */
function collectSpecEnums(node: unknown, found: string[][] = []): string[][] {
  if (Array.isArray(node)) {
    for (const item of node) collectSpecEnums(item, found);
    return found;
  }
  if (node === null || typeof node !== 'object') return found;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'enum' && Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      found.push(value as string[]);
    } else {
      collectSpecEnums(value, found);
    }
  }
  return found;
}

const fingerprint = (members: string[]): string => [...members].sort().join('|');

describe('generate-openapi', () => {
  it(`describes all ${ROUTE_COUNT} routes`, () => {
    const spec = loadSpec();
    const operations = Object.values(spec.paths).flatMap((methods) =>
      Object.keys(methods).filter((method) => HTTP_METHODS.includes(method)),
    );
    expect(operations).toHaveLength(ROUTE_COUNT);
  });

  it('contains every Prisma enum with exactly its schema.prisma members', () => {
    const prismaEnums = parsePrismaEnums();
    expect(prismaEnums.size).toBe(ENUM_COUNT);
    expect([...prismaEnums.values()].flat()).toHaveLength(ENUM_MEMBER_COUNT);

    const specFingerprints = collectSpecEnums(loadSpec()).map(fingerprint);
    for (const [name, members] of prismaEnums) {
      expect(specFingerprints, `${name} is missing from openapi.json or its members drifted`).toContain(
        fingerprint(members),
      );
    }
  });

  it('registers a response schema for every decorated classes route', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the assertions below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };

    expect(Object.keys(spec.components.schemas)).toEqual(
      expect.arrayContaining(['ClassRow', 'ClassDetail', 'PaginatedClassRow']),
    );
    expect(successRef('/api/classes', 'get')).toBe('#/components/schemas/PaginatedClassRow');
    expect(successRef('/api/classes', 'post')).toBe('#/components/schemas/ClassRow');
    expect(successRef('/api/classes/{id}', 'get')).toBe('#/components/schemas/ClassDetail');
    expect(successRef('/api/classes/{id}', 'patch')).toBe('#/components/schemas/ClassRow');
    // DELETE is decorated with NoContent: parsed at runtime, no body in the document.
    expect(successRef('/api/classes/{id}', 'delete')).toBeUndefined();
  });

  it('registers response schemas for the fees, payments and dashboard routes', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the table below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };
    const ref = (name: string): string => `#/components/schemas/${name}`;

    const expected: Array<[string, string, string | undefined]> = [
      ['/api/fees', 'get', ref('PaginatedFeeRow')],
      ['/api/fees', 'post', ref('Fee')],
      ['/api/fees/{id}', 'get', ref('FeeDetail')],
      ['/api/fees/{id}', 'patch', ref('Fee')],
      ['/api/fees/{id}', 'delete', undefined],
      ['/api/fees/generate-monthly', 'post', ref('GenerateResult')],
      ['/api/fees/generate-session', 'post', ref('GenerateResult')],
      ['/api/fees/{feeId}/payments', 'get', ref('PaymentList')],
      ['/api/fees/{feeId}/payments', 'post', ref('Payment')],
      ['/api/fees/{feeId}/payments/{id}', 'delete', undefined],
      ['/api/me/fees', 'get', ref('CustomerFeeEntryList')],
      ['/api/dashboard/fees-summary', 'get', ref('FeesSummaryEntryList')],
      ['/api/dashboard/cashflow-summary', 'get', ref('CashflowSummaryEntryList')],
    ];
    expect(expected).toHaveLength(13);
    for (const [path, method, expectedRef] of expected) {
      expect(successRef(path, method), `${method.toUpperCase()} ${path}`).toBe(expectedRef);
    }

    // The two sub-list routes stay plain arrays, per the pagination convention.
    const schemas = spec.components.schemas as Record<string, { type?: string }>;
    expect(schemas.PaymentList?.type).toBe('array');
    expect(schemas.CustomerFeeEntryList?.type).toBe('array');
  });

  it('registers response schemas for the trainees and contacts routes', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the table below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };
    const ref = (name: string): string => `#/components/schemas/${name}`;

    const expected: Array<[string, string, string | undefined]> = [
      ['/api/trainees', 'get', ref('PaginatedTrainee')],
      ['/api/trainees', 'post', ref('Trainee')],
      ['/api/trainees/{id}', 'get', ref('TraineeDetail')],
      ['/api/trainees/{id}', 'patch', ref('Trainee')],
      ['/api/trainees/{id}', 'delete', undefined],
      // The two routes with no UI caller get schemas like any other route.
      ['/api/trainees/{traineeId}/contacts', 'get', ref('ContactPersonList')],
      ['/api/trainees/{traineeId}/contacts/{id}', 'patch', ref('ContactPerson')],
      ['/api/trainees/{traineeId}/contacts', 'post', ref('ContactPerson')],
      ['/api/trainees/{traineeId}/contacts/{id}', 'delete', undefined],
    ];
    expect(expected).toHaveLength(9);
    for (const [path, method, expectedRef] of expected) {
      expect(successRef(path, method), `${method.toUpperCase()} ${path}`).toBe(expectedRef);
    }

    const schemas = spec.components.schemas as Record<
      string,
      { type?: string; properties?: Record<string, unknown> }
    >;
    expect(schemas.ContactPersonList?.type).toBe('array');
    // guardians is select-narrowed; the whole-row relations are not.
    expect(Object.keys(schemas.TraineeDetail?.properties ?? {})).toEqual(
      expect.arrayContaining(['contacts', 'locations', 'classes', 'guardians', 'user']),
    );
  });

  it('registers response schemas for the auth and memberships routes', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the table below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };
    const ref = (name: string): string => `#/components/schemas/${name}`;

    const expected: Array<[string, string, string | undefined]> = [
      ['/api/auth/login', 'post', ref('LoginResponse')],
      ['/api/auth/refresh', 'post', ref('RefreshResponse')],
      ['/api/auth/logout', 'post', undefined],
      ['/api/auth/forgot-password', 'post', ref('ForgotPasswordResponse')],
      ['/api/auth/reset-password', 'post', undefined],
      ['/api/auth/memberships', 'get', ref('LoginMembershipList')],
    ];
    expect(expected).toHaveLength(6);
    for (const [path, method, expectedRef] of expected) {
      expect(successRef(path, method), `${method.toUpperCase()} ${path}`).toBe(expectedRef);
    }

    const schemas = spec.components.schemas as Record<
      string,
      { properties?: Record<string, unknown>; anyOf?: unknown[] }
    >;
    // The published login contract carries no refresh token — it is a Set-Cookie (TKT-0036).
    expect(Object.keys(schemas.LoginResponse?.properties ?? {}).sort()).toEqual([
      'accessToken',
      'memberships',
    ]);
    // Refresh serves a cookie caller and a body caller, so the contract is a two-branch union.
    expect(schemas.RefreshResponse?.anyOf).toHaveLength(2);
    // No auth response publishes a credential field.
    const authJson = JSON.stringify([
      schemas.LoginResponse,
      schemas.RefreshResponse,
      schemas.ForgotPasswordResponse,
      schemas.LoginMembershipList,
    ]);
    for (const forbidden of ['passwordHash', 'tokenHash', 'resetToken', 'familyId']) {
      expect(authJson, `the auth contract must not publish "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });

  it('registers response schemas for the class-schedules routes', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the table below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };
    const ref = (name: string): string => `#/components/schemas/${name}`;

    const expected: Array<[string, string, string | undefined]> = [
      ['/api/class-schedules', 'get', ref('PaginatedClassSchedule')],
      ['/api/class-schedules', 'post', ref('ClassSchedule')],
      ['/api/class-schedules/{id}', 'get', ref('ClassSchedule')],
      ['/api/class-schedules/{id}', 'patch', ref('ClassSchedule')],
      ['/api/class-schedules/{id}', 'delete', undefined],
      // Reuses the component the fees generate routes already publish.
      ['/api/class-schedules/generate-sessions', 'post', ref('GenerateResult')],
    ];
    expect(expected).toHaveLength(6);
    for (const [path, method, expectedRef] of expected) {
      expect(successRef(path, method), `${method.toUpperCase()} ${path}`).toBe(expectedRef);
    }

    const schemas = spec.components.schemas as Record<
      string,
      { properties?: Record<string, { pattern?: string; enum?: string[] }> }
    >;
    // The wall-clock format is published, which is the only place it can be expressed:
    // openapi-typescript renders a patterned string as plain `string`.
    const properties = schemas.ClassSchedule?.properties ?? {};
    expect(properties.startTime?.pattern).toBe('^([01]\\d|2[0-3]):[0-5]\\d$');
    expect(properties.endTime?.pattern).toBe('^([01]\\d|2[0-3]):[0-5]\\d$');
    expect(properties.dayOfWeek?.enum).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  });

  it('registers response schemas for the sessions routes', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the table below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };
    const ref = (name: string): string => `#/components/schemas/${name}`;

    const expected: Array<[string, string, string | undefined]> = [
      ['/api/sessions', 'get', ref('PaginatedSession')],
      ['/api/sessions', 'post', ref('Session')],
      ['/api/sessions/{id}', 'get', ref('SessionDetail')],
      ['/api/sessions/{id}', 'patch', ref('Session')],
      ['/api/sessions/{id}', 'delete', undefined],
    ];
    expect(expected).toHaveLength(5);
    for (const [path, method, expectedRef] of expected) {
      expect(successRef(path, method), `${method.toUpperCase()} ${path}`).toBe(expectedRef);
    }

    const schemas = spec.components.schemas as Record<
      string,
      { properties?: Record<string, { type?: string; properties?: Record<string, unknown> }> }
    >;
    // Instants publish as strings, never as a date object.
    expect(schemas.Session?.properties?.startsAt?.type).toBe('string');
    expect(schemas.Session?.properties?.endsAt?.type).toBe('string');
    // Each relation publishes exactly the columns its select names.
    const detail = schemas.SessionDetail?.properties ?? {};
    expect(Object.keys(detail.class?.properties ?? {}).sort()).toEqual([
      'billingMode',
      'id',
      'name',
    ]);
    expect(Object.keys(detail.location?.properties ?? {}).sort()).toEqual(['id', 'name']);
  });

  it('registers response schemas for the attendances routes', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the table below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };
    const ref = (name: string): string => `#/components/schemas/${name}`;

    const expected: Array<[string, string, string | undefined]> = [
      ['/api/sessions/{sessionId}/attendances', 'get', ref('AttendanceWithTraineeList')],
      ['/api/sessions/{sessionId}/attendances', 'post', ref('Attendance')],
      ['/api/sessions/{sessionId}/attendances', 'put', ref('BulkMarkResult')],
      ['/api/sessions/{sessionId}/rsvp', 'patch', ref('Attendance')],
      ['/api/me/sessions', 'get', ref('CustomerSessionEntryList')],
    ];
    expect(expected).toHaveLength(5);
    for (const [path, method, expectedRef] of expected) {
      expect(successRef(path, method), `${method.toUpperCase()} ${path}`).toBe(expectedRef);
    }

    const schemas = spec.components.schemas as Record<
      string,
      { type?: string; properties?: Record<string, { anyOf?: Array<{ enum?: string[] }> }> }
    >;
    // Both sub-lists stay plain arrays, per the pagination convention.
    expect(schemas.AttendanceWithTraineeList?.type).toBe('array');
    expect(schemas.CustomerSessionEntryList?.type).toBe('array');
    // traineeRsvp is nullable in schema.prisma, so it publishes as the enum or null — the
    // frontend alias must strip the null (PRD-0008 §9: the enum is reachable, not dead).
    const rsvp = schemas.Attendance?.properties?.traineeRsvp?.anyOf ?? [];
    expect(rsvp.find((branch) => branch.enum)?.enum).toEqual([
      'CONFIRMED',
      'DECLINED',
      'RESCHEDULE_REQUESTED',
    ]);
  });

  it('registers response schemas for the users routes', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the table below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };
    const ref = (name: string): string => `#/components/schemas/${name}`;

    const expected: Array<[string, string, string | undefined]> = [
      ['/api/users', 'get', ref('PaginatedUserSummary')],
      ['/api/users', 'post', ref('CreatedUser')],
      ['/api/users/{id}', 'get', ref('UserSummary')],
      ['/api/users/{id}', 'patch', ref('UserSummary')],
      ['/api/users/{id}', 'delete', undefined],
      // TKT-0060: resend. Reports delivery only — it publishes no account fields.
      ['/api/users/{id}/invite', 'post', ref('InviteResult')],
    ];
    expect(expected).toHaveLength(6);
    for (const [path, method, expectedRef] of expected) {
      expect(successRef(path, method), `${method.toUpperCase()} ${path}`).toBe(expectedRef);
    }

    const schemas = spec.components.schemas as Record<
      string,
      { properties?: Record<string, unknown>; required?: string[] }
    >;
    // The published account contract carries no credential and no cross-tenant membership list.
    const userJson = JSON.stringify([schemas.UserSummary, schemas.CreatedUser]);
    for (const forbidden of ['passwordHash', 'isSuperAdmin', 'memberships']) {
      expect(userJson, `the users contract must not publish "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
    // attachedExisting is present but optional — a plain create omits the key entirely.
    expect(Object.keys(schemas.CreatedUser?.properties ?? {})).toContain('attachedExisting');
    expect(schemas.CreatedUser?.required ?? []).not.toContain('attachedExisting');
  });

  it('registers response schemas for the locations routes', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the table below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };
    const ref = (name: string): string => `#/components/schemas/${name}`;

    const expected: Array<[string, string, string | undefined]> = [
      ['/api/locations', 'get', ref('PaginatedLocation')],
      ['/api/locations', 'post', ref('Location')],
      ['/api/locations/{id}', 'get', ref('Location')],
      ['/api/locations/{id}', 'patch', ref('Location')],
      // Declared as NoContent: parsed at runtime, deliberately body-less in the document.
      ['/api/locations/{id}', 'delete', undefined],
    ];
    expect(expected).toHaveLength(5);
    for (const [path, method, expectedRef] of expected) {
      expect(successRef(path, method), `${method.toUpperCase()} ${path}`).toBe(expectedRef);
    }

    const schemas = spec.components.schemas as Record<
      string,
      { properties?: Record<string, { properties?: Record<string, unknown> }> }
    >;
    // The full row publishes all seven columns...
    expect(Object.keys(schemas.Location?.properties ?? {}).sort()).toEqual([
      'address',
      'createdAt',
      'id',
      'isActive',
      'name',
      'tenantId',
      'updatedAt',
    ]);
    // ...while every embedder publishes exactly the two-column reference. Confusing the two is
    // the ClassDetail.locations defect this epic exists to make impossible.
    const embedded = schemas.SessionDetail?.properties?.location?.properties ?? {};
    expect(Object.keys(embedded).sort()).toEqual(['id', 'name']);
  });

  it('registers response schemas for the dashboard, tenants and health routes', () => {
    const spec = loadSpec();
    const successRef = (path: string, method: string): string | undefined => {
      // eslint-disable-next-line security/detect-object-injection -- literals from the table below
      const responses = spec.paths[path]?.[method]?.responses ?? {};
      const success = Object.entries(responses).find(([code]) => code.startsWith('2'))?.[1];
      return success?.content?.['application/json']?.schema?.$ref;
    };
    const ref = (name: string): string => `#/components/schemas/${name}`;

    // The two dashboard rows were registered by TKT-0043; asserted here so the group is complete.
    const expected: Array<[string, string, string | undefined]> = [
      ['/api/dashboard/fees-summary', 'get', ref('FeesSummaryEntryList')],
      ['/api/dashboard/cashflow-summary', 'get', ref('CashflowSummaryEntryList')],
      ['/api/tenants', 'get', ref('TenantSummaryList')],
      ['/api/health', 'get', ref('Health')],
    ];
    expect(expected).toHaveLength(4);
    for (const [path, method, expectedRef] of expected) {
      expect(successRef(path, method), `${method.toUpperCase()} ${path}`).toBe(expectedRef);
    }

    const schemas = spec.components.schemas as Record<
      string,
      { type?: string; items?: { properties?: Record<string, unknown> }; properties?: Record<string, { type?: string; const?: string }> }
    >;
    expect(schemas.TenantSummaryList?.type).toBe('array');
    expect(Object.keys(schemas.TenantSummaryList?.items?.properties ?? {}).sort()).toEqual([
      'id',
      'isActive',
      'name',
      'slug',
    ]);
    // health's timestamp is already an ISO string at the controller, so it publishes as a plain
    // string with no transform, and status is pinned to the literal the controller returns.
    expect(schemas.Health?.properties?.timestamp?.type).toBe('string');
    expect(schemas.Health?.properties?.status?.const).toBe('ok');
  });

  it(`registers a @ResponseSchema for every one of the ${ROUTE_COUNT} routes`, async () => {
    // Importing the root module loads every controller, which is what runs the decorators
    // and fills the registry. A new route shipped without one has no entry here, so it is
    // named below rather than publishing an empty response shape.
    await import('./app.module');

    const undecorated = Object.entries(loadSpec().paths).flatMap(([route, methods]) =>
      Object.entries(methods)
        .filter(([method]) => HTTP_METHODS.includes(method))
        .filter(([, operation]) => !responseSchemas.has(operation.operationId ?? ''))
        .map(([method]) => `${method.toUpperCase()} ${route}`),
    );
    expect(undecorated, `route(s) with no @ResponseSchema: ${undecorated.join(', ')}`).toEqual([]);
    expect(responseSchemas.size).toBe(ROUTE_COUNT);
  });

  it('names DATABASE_URL when the app cannot boot', () => {
    const message = bootFailureMessage(new Error('P1003: database does not exist'));
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('P1003: database does not exist');
  });
});
