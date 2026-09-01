import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Response types are generated from the zod schemas the backend interceptor parses with, so
// a `select` that stops matching its schema fails a backend test instead of reaching a page.

const read = (...segments: string[]): string =>
  readFileSync(path.resolve(process.cwd(), ...segments), 'utf8');

const apiResources = read('lib', 'api-resources.ts');
const apiSchema = read('lib', 'api-schema.d.ts');
const authStorage = read('lib', 'auth-storage.ts');

/** The generated block for one schema, up to the next named member. */
const block = (name: string, until: string): string => {
  const start = apiSchema.indexOf(`${name}: {`);
  return apiSchema.slice(start, apiSchema.indexOf(until, start));
};

/** One property of a generated schema, up to the property that follows it. */
const property = (schema: string, from: string, until: string): string => {
  const body = apiSchema.slice(apiSchema.indexOf(`${schema}: {`));
  return body.slice(body.indexOf(from), body.indexOf(until));
};

const assertAliases = (source: string, expected: Record<string, string>): void => {
  for (const [name, target] of Object.entries(expected)) {
    expect(source, `${name} is not aliased to ${target}`).toContain(
      `export type ${name} = ${target};`,
    );
  }
};

describe('generated classes response types', () => {
  it('declares ClassRow and ClassDetail as generated schema aliases', () => {
    assertAliases(apiResources, {
      ClassRow: "components['schemas']['ClassRow']",
      ClassDetail: "components['schemas']['ClassDetail']",
    });
    expect(apiResources).not.toMatch(/^export interface Class(Row|Detail)\b/m);
  });

  it('generates ClassDetail.locations as exactly id and name', () => {
    const locations = property('ClassDetail', 'locations:', 'trainees:');
    expect(locations).toMatch(/id: string;/);
    expect(locations).toMatch(/name: string;/);
    expect(locations).not.toMatch(/address/);
    expect(locations).not.toMatch(/isActive/);
  });
});

describe('generated money response types', () => {
  // Array routes register `<Item>List`, so the frontend aliases the item with [number].
  it('declares the money types as generated schema aliases', () => {
    assertAliases(apiResources, {
      FeeRow: "components['schemas']['PaginatedFeeRow']['items'][number]",
      FeeDetail: "components['schemas']['FeeDetail']",
      Payment: "components['schemas']['Payment']",
      CustomerFeeEntry: "components['schemas']['CustomerFeeEntryList'][number]",
      GenerateFeesResult: "components['schemas']['GenerateResult']",
      FeesSummaryEntry: "components['schemas']['FeesSummaryEntryList'][number]",
      CashflowSummaryEntry: "components['schemas']['CashflowSummaryEntryList'][number]",
    });
    expect(apiResources).not.toMatch(/^export interface (FeeRow|FeeDetail|Payment)\b/m);
  });

  it('derives FeeStatus from the generated schema instead of a hand-written union', () => {
    expect(apiResources).toContain(
      "export type FeeStatus = components['schemas']['Fee']['status'];",
    );
    expect(apiResources).not.toMatch(/'UNPAID'\s*\|\s*'PARTIAL'\s*\|\s*'PAID'/);
  });

  it('generates every amount as a string and the summary sums as numbers', () => {
    const fee = block('Fee', 'FeeDetail: {');
    expect(fee).toMatch(/amount: string;/);
    expect(fee).not.toMatch(/amount: number;/);

    const start = apiSchema.indexOf('FeesSummaryEntryList:');
    expect(apiSchema.slice(start, start + 400)).toMatch(/collected: number;/);
  });
});

describe('generated trainee response types', () => {
  it('declares the trainee types as generated schema aliases', () => {
    assertAliases(apiResources, {
      ContactPerson: "components['schemas']['ContactPerson']",
      Trainee: "components['schemas']['Trainee']",
      TraineeDetail: "components['schemas']['TraineeDetail']",
    });
    expect(apiResources).not.toMatch(
      /^export interface (Trainee|TraineeDetail|ContactPerson)\b/m,
    );
  });

  it('derives ContactRelationship from the generated schema', () => {
    expect(apiResources).toContain(
      "export type ContactRelationship = components['schemas']['ContactPerson']['relationship'];",
    );
    expect(apiResources).not.toMatch(/'PARENT'\s*\|\s*'GUARDIAN'/);
  });

  it('generates TraineeDetail.guardians as exactly the four selected columns', () => {
    const guardians = property('TraineeDetail', 'guardians:', 'user:');
    for (const field of ['id', 'firstName', 'lastName', 'email']) {
      expect(guardians, `guardians is missing ${field}`).toMatch(new RegExp(`${field}:`));
    }
    expect(guardians).not.toMatch(/isActive/);
    expect(guardians).not.toMatch(/tenantId/);
  });
});

describe('generated session response types', () => {
  it('declares the session types as generated schema aliases', () => {
    assertAliases(apiResources, {
      SessionRow: "components['schemas']['Session']",
      SessionDetail: "components['schemas']['SessionDetail']",
    });
    expect(apiResources).not.toMatch(/^export interface Session(Row|Detail)\b/m);
  });

  it('derives SessionStatus from the generated schema instead of a hand-written union', () => {
    expect(apiResources).toContain(
      "export type SessionStatus = components['schemas']['Session']['status'];",
    );
    expect(apiResources).not.toMatch(/'SCHEDULED'\s*\|\s*'COMPLETED'/);
    // BillingMode's only consumer was SessionDetail.class, so aliasing it orphans the union.
    expect(apiResources).not.toMatch(/'PER_MONTH'\s*\|\s*'PER_SESSION'/);
  });

  it('generates the SessionDetail relations as exactly the selected columns', () => {
    const cls = property('SessionDetail', 'class:', 'location:');
    expect(cls).toMatch(/billingMode/);
    expect(cls).not.toMatch(/description/);

    // 'PaginatedClassSchedule: {' (the next declared schema), not 'trainers:' — SessionSchema
    // now has its own (optional) trainers field ahead of location in declaration order, so
    // 'trainers:' is no longer the boundary right after location's own block.
    const location = property('SessionDetail', 'location:', 'PaginatedClassSchedule: {');
    expect(location).toMatch(/name:/);
    expect(location).not.toMatch(/address/);
    expect(location).not.toMatch(/isActive/);
  });

  it('generates every session instant as a string', () => {
    const session = block('Session', 'SessionDetail: {');
    expect(session).toMatch(/startsAt: string;/);
    expect(session).toMatch(/endsAt: string;/);
    expect(session).not.toMatch(/startsAt: Date/);
  });
});

describe('generated class-schedule response types', () => {
  it('declares the class-schedule types as generated schema aliases', () => {
    assertAliases(apiResources, {
      ClassSchedule: "components['schemas']['ClassSchedule']",
      GenerateSessionsResult: "components['schemas']['GenerateResult']",
    });
    expect(apiResources).not.toMatch(/^export interface (ClassSchedule|GenerateSessionsResult)\b/m);
  });

  it('derives DayOfWeek from the generated schema instead of a hand-written union', () => {
    expect(apiResources).toContain(
      "export type DayOfWeek = components['schemas']['ClassSchedule']['dayOfWeek'];",
    );
    expect(apiResources).not.toMatch(/'MON'\s*\|\s*'TUE'/);
  });

  it('publishes the HH:MM pattern in the spec even though the type stays string', () => {
    // openapi-typescript cannot express a patterned string, so the generated type is `string`.
    // The format lives in openapi.json and in the runtime parse — stated here rather than
    // implied, so nobody reads `string` as the schema having lost the pattern.
    const schedule = block('ClassSchedule', 'PaginatedClassSchedule: {');
    expect(schedule).toMatch(/startTime: string;/);
    expect(schedule).toMatch(/endTime: string;/);

    const spec = read('..', 'backend', 'openapi.json');
    const { pattern } = JSON.parse(spec).components.schemas.ClassSchedule.properties.startTime;
    expect(pattern).toBe('^([01]\\d|2[0-3]):[0-5]\\d$');
  });
});

describe('generated attendance response types', () => {
  it('declares the attendance types as generated schema aliases', () => {
    assertAliases(apiResources, {
      Attendance: "components['schemas']['Attendance']",
      AttendanceWithTrainee: "components['schemas']['AttendanceWithTraineeList'][number]",
      CustomerSessionEntry: "components['schemas']['CustomerSessionEntryList'][number]",
    });
    expect(apiResources).not.toMatch(/^export interface (Attendance|CustomerSessionEntry)\b/m);
  });

  it('derives the attendance enums from the generated schema', () => {
    expect(apiResources).toContain(
      "export type AttendanceStatus = components['schemas']['Attendance']['status'];",
    );
    // traineeRsvp is nullable in schema.prisma, but the union is used as a non-null value type
    // (`choice: AttendanceRsvp`), so a plain alias would silently widen it to accept null.
    expect(apiResources).toContain(
      "export type AttendanceRsvp = NonNullable<components['schemas']['Attendance']['traineeRsvp']>;",
    );
    expect(apiResources).not.toMatch(/'PENDING'\s*\|\s*'PRESENT'/);
    expect(apiResources).not.toMatch(/'CONFIRMED'\s*\|\s*'DECLINED'/);
  });

  it('generates the attendance trainee subset as exactly id, firstName and lastName', () => {
    const trainee = property('AttendanceWithTraineeList', 'trainee:', '};');
    for (const field of ['id', 'firstName', 'lastName']) {
      expect(trainee, `trainee is missing ${field}`).toMatch(new RegExp(`${field}:`));
    }
    expect(trainee).not.toMatch(/dateOfBirth/);
    expect(trainee).not.toMatch(/tenantId/);
  });
});

describe('generated user response types', () => {
  it('declares the user types as generated schema aliases', () => {
    assertAliases(apiResources, {
      UserRow: "components['schemas']['UserSummary']",
      CreatedUser: "components['schemas']['CreatedUser']",
    });
    expect(apiResources).not.toMatch(/^export interface UserRow\b/m);
  });

  it('derives AppUserRole from the generated schema instead of a hand-written union', () => {
    expect(apiResources).toContain(
      "export type AppUserRole = components['schemas']['UserSummary']['role'];",
    );
    // The last hand-written enum union in the frontend — all eight now arrive by generation.
    expect(apiResources).not.toMatch(/'SUPER_ADMIN'\s*\|\s*'ADMIN'/);
  });

  it('publishes no credential or cross-tenant field in the generated user contract', () => {
    const summary = block('UserSummary', 'CreatedUser: {');
    // Guard the guard: an absent schema would make the sweep below pass on an empty string.
    expect(summary).toMatch(/email: string;/);
    for (const forbidden of ['passwordHash', 'isSuperAdmin', 'memberships']) {
      expect(summary, `the generated user types must not name "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });
});

describe('generated location response types', () => {
  it('declares Location as a generated schema alias', () => {
    assertAliases(apiResources, {
      Location: "components['schemas']['Location']",
    });
    expect(apiResources).not.toMatch(/^export interface Location\b/m);
  });

  it('generates the full location row, distinct from the two-column embedded reference', () => {
    const location = block('Location', 'LoginMembership');
    expect(location).toMatch(/address\?*: string \| null;/);
    expect(location).toMatch(/tenantId: string;/);
    expect(location).toMatch(/isActive: boolean;/);

    // The embedders publish only id and name — the distinction this module exists to name.
    // 'PaginatedClassSchedule: {', not 'trainers:' — see the same note above.
    const embedded = property('SessionDetail', 'location:', 'PaginatedClassSchedule: {');
    expect(embedded).toMatch(/name:/);
    expect(embedded).not.toMatch(/address/);
    expect(embedded).not.toMatch(/isActive/);
  });
});

describe('generated tenant response types', () => {
  it('declares TenantSummary as a generated schema alias', () => {
    assertAliases(apiResources, {
      TenantSummary: "components['schemas']['TenantSummaryList'][number]",
    });
    expect(apiResources).not.toMatch(/^export interface TenantSummary\b/m);
  });
});

describe('the hand-written API type count', () => {
  // PRD-0008 §8's headline number: every request and response type in api-resources.ts is now
  // generated. This is the count TKT-0052 enforces in CI.
  it('declares no hand-written request or response type in api-resources.ts', () => {
    const interfaces = apiResources.match(/^export interface \w+/gm) ?? [];
    expect(interfaces, `still hand-written: ${interfaces.join(', ')}`).toEqual([]);

    // A string-literal union is the other way a hand-written type hides here (the 8 enums).
    const literalUnions = apiResources.match(/^export type \w+ = '[^']+'/gm) ?? [];
    expect(literalUnions, `still hand-written: ${literalUnions.join(', ')}`).toEqual([]);
  });
});

describe('generated auth response types', () => {
  it('derives UserRole and LoginMembership from the generated schema', () => {
    // Both live in auth-storage.ts, not api-resources.ts.
    assertAliases(authStorage, {
      UserRole: "components['schemas']['LoginMembershipList'][number]['role']",
      LoginMembership: "components['schemas']['LoginMembershipList'][number]",
    });
    expect(authStorage).not.toMatch(/'SUPER_ADMIN'\s*\|\s*'ADMIN'/);
    expect(authStorage).not.toMatch(/^export interface LoginMembership\b/m);
  });

  it('publishes no credential field in the generated auth contract', () => {
    const start = apiSchema.indexOf('LoginResponse: {');
    const authBlock = apiSchema.slice(start, start + 1200);
    for (const forbidden of ['passwordHash', 'tokenHash', 'resetToken', 'familyId']) {
      expect(authBlock, `generated auth types must not name "${forbidden}"`).not.toContain(
        forbidden,
      );
    }
  });
});
