import { apiRequest } from './api';
import type { components } from './api-schema';

// Shared shapes — mirror the Prisma rows the backend returns. We keep these intentionally
// loose (not generated from schema) since Phase 2 only consumes a small slice.

// Envelope returned by every paginated list endpoint (mirrors backend PaginatedResult).
interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Backend defaults to pageSize 25 and caps at 100.
interface PageParams {
  page?: number;
  pageSize?: number;
}

// The largest page the backend will serve (PaginationQueryDto's @Max), so "all" is
// fetched in as few requests as the API allows.
const MAX_PAGE_SIZE = 100;

// Every row, for dropdowns and lookup maps that want "all". It follows the remaining
// pages rather than returning only the first: a truncated dropdown or name map looks
// exactly like a complete one, so silently stopping at row 100 is the worst failure here.
// Sequential because real page counts are small; parallelising buys nothing measurable.
export async function listAll<T>(
  list: (params: PageParams) => Promise<PaginatedResult<T>>,
): Promise<T[]> {
  const first = await list({ pageSize: MAX_PAGE_SIZE });
  const items = [...first.items];
  for (let page = 2; page <= first.totalPages; page += 1) {
    items.push(...(await list({ page, pageSize: MAX_PAGE_SIZE })).items);
  }
  return items;
}

// The full seven-field row these endpoints return. Distinct from the two-column reference other
// modules embed (SessionDetail.location, UserRow.locations, ClassDetail.locations) — the backend
// names both shapes separately so they cannot be confused, which is the defect PRD-0008 started on.
export type Location = components['schemas']['Location'];

// Generated from the zod schemas the backend interceptor parses responses with, so the
// narrow `locations: { id, name }` shape on ClassDetail is now enforced server-side rather
// than described by hand here.
export type ClassRow = components['schemas']['ClassRow'];
export type ClassDetail = components['schemas']['ClassDetail'];

// ContactRelationship is declared once in schema.prisma and reaches us through the generated
// ContactPerson.
export type ContactRelationship = components['schemas']['ContactPerson']['relationship'];

export type ContactPerson = components['schemas']['ContactPerson'];

// dateOfBirth is a full ISO timestamp on the wire — trainee-form slices it to YYYY-MM-DD.
export type Trainee = components['schemas']['Trainee'];

// guardians and user are narrowed by `select` in classes.service-style includes; contacts,
// locations and classes come back whole. The backend schema enforces both now.
export type TraineeDetail = components['schemas']['TraineeDetail'];

// Inputs sent to the backend. Generated from backend/openapi.json — see `gen:api` +
// `gen:types`. Never hand-write one: a hand-written request type is the drift PRD-0008
// exists to stop. billingMode stays absent from UpdateClassDto (immutable after create)
// and contacts from UpdateTraineeDto (managed via /trainees/:id/contacts/*).

type CreateLocationInput = components['schemas']['CreateLocationDto'];
type UpdateLocationInput = components['schemas']['UpdateLocationDto'];

type CreateClassInput = components['schemas']['CreateClassDto'];
type UpdateClassInput = components['schemas']['UpdateClassDto'];

type ContactInput = components['schemas']['CreateContactDto'];

type CreateTraineeInput = components['schemas']['CreateTraineeDto'];
type UpdateTraineeInput = components['schemas']['UpdateTraineeDto'];

// The SUPER_ADMIN tenant selector's payload. GET /tenants answers without an X-Tenant-Id header,
// which is what lets the selector load before a tenant is chosen.
export type TenantSummary = components['schemas']['TenantSummaryList'][number];

// The last hand-written enum union in this file: all eight now arrive by generation.
export type AppUserRole = components['schemas']['UserSummary']['role'];

// The backend parses every user response through this shape, which is an allowlist — the query
// selects `isSuperAdmin` and `memberships` (the account's tenants) and the parse strips both.
export type UserRow = components['schemas']['UserSummary'];

// POST /users: the same row plus the attach flag, which a plain create omits entirely.
export type CreatedUser = components['schemas']['CreatedUser'];

// POST /users/:id/invite — delivery report only, no account fields.
export type InviteResult = components['schemas']['InviteResult'];

type CreateUserInput = components['schemas']['CreateUserDto'];
type UpdateUserInput = components['schemas']['UpdateUserDto'];

type CreateTenantInput = components['schemas']['CreateTenantDto'];
type CreatedTenant = components['schemas']['CreatedTenant'];

// Both routes are @Roles(SUPER_ADMIN) and neither reads @TenantId(), so omitting the tenant
// header removes no check — and it is what keeps a stale stored club from 404ing the two calls
// that exist to recover from it (tenant-context.guard.ts:56 rejects a header naming a club the
// server does not have). Never copy this flag onto a route whose authorization depends on the
// per-tenant role: the guard's role swap reads the header it would drop.
export const Tenants = {
  list: () => apiRequest<TenantSummary[]>('/tenants', { omitTenantHeader: true }),
  // Onboards a club with its first location and its first administrator, in one call.
  // The response carries notificationSent: the new administrator has no password, so the
  // invite mail is their only way in and a silent failure would strand the club.
  create: (input: CreateTenantInput) =>
    apiRequest<CreatedTenant>('/tenants', {
      method: 'POST',
      body: input,
      omitTenantHeader: true,
    }),
};

// The active-tenant gate and the club selector both need this list and mount in the same
// commit, so they share one request. Shaped like tryRefresh() in api.ts:100-107 — the slot
// clears on settle, so nothing is cached and a failure is never memoized. A request that
// never settles does hold the slot, which is what resetClubsRequest() below is for.
// Inactive clubs are dropped here so every caller agrees on what a club is;
// GET /tenants selects isActive but applies no `where` (tenants.controller.ts:31-38), and the
// guard answers 404 for an inactive club exactly as for a missing one.
// ponytail: reactStrictMode double-invokes effects, so development can still see two requests
// once the first settles. Production mounts once.
/**
 * The active clubs, plus whether the API capped the response.
 *
 * `truncated` matters because callers must not treat absence from `clubs` as proof that a club does
 * not exist: above the cap the club selector cannot offer it either, so a stored id is the only
 * remaining way into it. The shape is inline rather than a named `export interface` — this file is
 * held to generated-only API types (PRD-0008, `api-response-aliases.test.ts`), and the payload type
 * `TenantSummary` still comes from the generated schema.
 */
let inFlightClubs: Promise<{ clubs: TenantSummary[]; truncated: boolean }> | null = null;

export function listClubs(): Promise<{ clubs: TenantSummary[]; truncated: boolean }> {
  if (!inFlightClubs) {
    inFlightClubs = Tenants.list()
      .then((all) => ({
        clubs: all.filter((club) => club.isActive),
        // Judged on what the API returned, before the filter: a capped response full of inactive
        // clubs would otherwise look short and licence a wrongful discard.
        truncated: all.length >= MAX_PAGE_SIZE,
      }))
      .finally(() => {
        inFlightClubs = null;
      });
  }
  return inFlightClubs;
}

/**
 * Drops the in-flight slot. For tests: the slot clears itself when the request settles, but a
 * request that never settles holds it for the life of the module, and Vitest shares a module
 * registry across the cases in one file. Production has no caller — a page whose fetch never
 * settles is not going anywhere either.
 */
export function resetClubsRequest(): void {
  inFlightClubs = null;
}

interface UserListFilters {
  /** Membership role in the acting club — the server matches it there, not on User. */
  role?: AppUserRole;
}

export const Users = {
  list: (params: UserListFilters & PageParams = {}) =>
    apiRequest<PaginatedResult<UserRow>>(`/users${buildQuery({ ...params })}`),
  get: (id: string) => apiRequest<UserRow>(`/users/${id}`),
  // attachedExisting: the email already had an account — a membership was attached,
  // the submitted password was ignored (TKT-0003).
  create: (input: CreateUserInput) =>
    apiRequest<CreatedUser>('/users', {
      method: 'POST',
      body: input,
    }),
  update: (id: string, input: UpdateUserInput) =>
    apiRequest<UserRow>(`/users/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/users/${id}`, { method: 'DELETE' }),
  // TKT-0060: re-issues the invite for a pending account. 409 if it has already been accepted
  // or has been deactivated. inviteEmailSent is a report, not an error — false still means the
  // new link exists and the old one is dead.
  resendInvite: (id: string) =>
    apiRequest<InviteResult>(`/users/${id}/invite`, { method: 'POST' }),
};

export const Locations = {
  list: (params: PageParams = {}) =>
    apiRequest<PaginatedResult<Location>>(`/locations${buildQuery({ ...params })}`),
  get: (id: string) => apiRequest<Location>(`/locations/${id}`),
  create: (input: CreateLocationInput) =>
    apiRequest<Location>('/locations', { method: 'POST', body: input }),
  update: (id: string, input: UpdateLocationInput) =>
    apiRequest<Location>(`/locations/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/locations/${id}`, { method: 'DELETE' }),
};

// Filter sets, shaped like FeeListFilters above: hand-written because they describe query params,
// while every payload type still comes from the generated schema. Not exported, which is what
// PRD-0008's "no hand-written API type" rule pins (api-response-aliases.test.ts) — a query-param
// shape is this module's own business, and callers pass an object literal.
interface ClassListFilters {
  isActive?: boolean;
}

interface SessionListFilters {
  /** Inclusive lower bound on startsAt. */
  startsAtFrom?: string;
  /** Exclusive upper bound — a week is half-open, so its last instant belongs to the next one. */
  startsAtBefore?: string;
}

export const Classes = {
  list: (params: ClassListFilters & PageParams = {}) =>
    apiRequest<PaginatedResult<ClassRow>>(`/classes${buildQuery({ ...params })}`),
  get: (id: string) => apiRequest<ClassDetail>(`/classes/${id}`),
  create: (input: CreateClassInput) =>
    apiRequest<ClassRow>('/classes', { method: 'POST', body: input }),
  update: (id: string, input: UpdateClassInput) =>
    apiRequest<ClassRow>(`/classes/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/classes/${id}`, { method: 'DELETE' }),
};

export const Trainees = {
  list: (params: PageParams = {}) =>
    apiRequest<PaginatedResult<Trainee>>(`/trainees${buildQuery({ ...params })}`),
  get: (id: string) => apiRequest<TraineeDetail>(`/trainees/${id}`),
  create: (input: CreateTraineeInput) =>
    apiRequest<Trainee>('/trainees', { method: 'POST', body: input }),
  update: (id: string, input: UpdateTraineeInput) =>
    apiRequest<Trainee>(`/trainees/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/trainees/${id}`, { method: 'DELETE' }),
};

export const Contacts = {
  create: (traineeId: string, input: ContactInput) =>
    apiRequest<ContactPerson>(`/trainees/${traineeId}/contacts`, {
      method: 'POST',
      body: input,
    }),
  remove: (traineeId: string, id: string) =>
    apiRequest<void>(`/trainees/${traineeId}/contacts/${id}`, { method: 'DELETE' }),
};

// === Phase 3 — Sessions, Schedules, Attendances ===

// SessionStatus is declared once in schema.prisma and reaches us through the generated Session.
export type SessionStatus = components['schemas']['Session']['status'];
// Both attendance enums are declared once in schema.prisma and reach us through the generated
// Attendance. traineeRsvp is nullable there, but this union is used as a non-null value type
// (`choice: AttendanceRsvp`), so the null is stripped rather than carried into every handler.
export type AttendanceStatus = components['schemas']['Attendance']['status'];
export type AttendanceRsvp = NonNullable<components['schemas']['Attendance']['traineeRsvp']>;
// DayOfWeek is declared once in schema.prisma and reaches us through the generated ClassSchedule.
export type DayOfWeek = components['schemas']['ClassSchedule']['dayOfWeek'];

// startsAt and endsAt are real instants, transformed server-side to exactly the ISO string
// JSON.stringify already produced — dashboard/page.tsx parses startsAt with `new Date(...)`.
export type SessionRow = components['schemas']['Session'];
// The three relation subsets are enforced against their Prisma `select` server-side.
export type SessionDetail = components['schemas']['SessionDetail'];

type CreateSessionInput = components['schemas']['CreateSessionDto'];
// classId is absent from UpdateSessionDto — a session cannot move to another class.
type UpdateSessionInput = components['schemas']['UpdateSessionDto'];

// startTime and endTime are "HH:MM" 24-hour wall-clock strings. The backend schema publishes
// that pattern in openapi.json and enforces it on every response; openapi-typescript cannot
// express a patterned string, so they arrive here as plain `string`.
export type ClassSchedule = components['schemas']['ClassSchedule'];

type CreateClassScheduleInput = components['schemas']['CreateClassScheduleDto'];
// A schedule cannot move to another class, so UpdateClassScheduleDto omits classId.
type UpdateClassScheduleInput = components['schemas']['UpdateClassScheduleDto'];

type GenerateSessionsInput = components['schemas']['GenerateSessionsDto'];
// The same component the fees generate routes return — one shape, declared once server-side.
export type GenerateSessionsResult = components['schemas']['GenerateResult'];

export type Attendance = components['schemas']['Attendance'];

// What GET /sessions/:id/attendances returns: the row plus the trainee's name, so the
// attendance screen never resolves traineeId against a separately-paged trainee list. The
// three-column subset is enforced against ATTENDANCE_WITH_TRAINEE server-side (TKT-0038).
export type AttendanceWithTrainee = components['schemas']['AttendanceWithTraineeList'][number];

type BulkMarkAttendancesInput = components['schemas']['BulkMarkAttendancesDto'];
type BulkMarkResult = components['schemas']['BulkMarkResult'];

type RsvpInput = components['schemas']['RsvpDto'];

export const Sessions = {
  list: (params: SessionListFilters & PageParams = {}) =>
    apiRequest<PaginatedResult<SessionRow>>(`/sessions${buildQuery({ ...params })}`),
  get: (id: string) => apiRequest<SessionDetail>(`/sessions/${id}`),
  create: (input: CreateSessionInput) =>
    apiRequest<SessionRow>('/sessions', { method: 'POST', body: input }),
  update: (id: string, input: UpdateSessionInput) =>
    apiRequest<SessionRow>(`/sessions/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/sessions/${id}`, { method: 'DELETE' }),
};

export const ClassSchedules = {
  list: (params: PageParams = {}) =>
    apiRequest<PaginatedResult<ClassSchedule>>(`/class-schedules${buildQuery({ ...params })}`),
  get: (id: string) => apiRequest<ClassSchedule>(`/class-schedules/${id}`),
  create: (input: CreateClassScheduleInput) =>
    apiRequest<ClassSchedule>('/class-schedules', { method: 'POST', body: input }),
  update: (id: string, input: UpdateClassScheduleInput) =>
    apiRequest<ClassSchedule>(`/class-schedules/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/class-schedules/${id}`, { method: 'DELETE' }),
  generateSessions: (input: GenerateSessionsInput) =>
    apiRequest<GenerateSessionsResult>('/class-schedules/generate-sessions', {
      method: 'POST',
      body: input,
    }),
};

// Customer-portal payload — sessions enriched with class/location and the attendance rows
// for trainees the customer owns/guards (server-side filtered). Built server-side by extending
// the same SessionSchema GET /sessions uses, so the portal cannot describe a session differently.
export type CustomerSessionEntry = components['schemas']['CustomerSessionEntryList'][number];

export const Attendances = {
  /**
   * A session's attendance rows, plus whether the API capped the response.
   *
   * The route is an unpaginated sub-list hard-capped at MAX_PAGE_SIZE server-side, and the
   * attendance screen submits a snapshot of the rows it rendered — so a full page means the
   * trainer may be about to leave unseen attendees unmarked, and they have to be told. Same
   * inference as listClubs() below, including its one false positive: a session with exactly
   * MAX_PAGE_SIZE attendees is reported as possibly-truncated. Erring that way is the point.
   */
  listForSession: (sessionId: string) =>
    apiRequest<AttendanceWithTrainee[]>(`/sessions/${sessionId}/attendances`).then((items) => ({
      items,
      truncated: items.length >= MAX_PAGE_SIZE,
    })),
  /**
   * The trainees who can still be added to this session: active, in scope, and not on it already.
   * Both filters are the server's now — the screen used to page every trainee in the club on every
   * session open and apply them in the browser, which no pageSize could fix because neither filter
   * existed server-side (TKT-0071).
   */
  listCandidates: (sessionId: string, params: PageParams = {}) =>
    apiRequest<PaginatedResult<Trainee>>(
      `/sessions/${sessionId}/attendance-candidates${buildQuery({ ...params })}`,
    ),
  addTrainee: (sessionId: string, traineeId: string) =>
    apiRequest<Attendance>(`/sessions/${sessionId}/attendances`, {
      method: 'POST',
      body: { traineeId },
    }),
  bulkMark: (sessionId: string, input: BulkMarkAttendancesInput) =>
    apiRequest<BulkMarkResult>(`/sessions/${sessionId}/attendances`, {
      method: 'PUT',
      body: input,
    }),
  rsvp: (sessionId: string, input: RsvpInput) =>
    apiRequest<Attendance>(`/sessions/${sessionId}/rsvp`, {
      method: 'PATCH',
      body: input,
    }),
  myUpcoming: () => apiRequest<CustomerSessionEntry[]>('/me/sessions'),
};

// === Phase 4 — Fees, Payments, Dashboard ===

// Generated from the zod schemas the backend parses money responses with. Every amount is a
// Prisma Decimal serialized as a string — the schema enforces that server-side now, so a
// number here would fail a backend test rather than reach formatMoney.
// FeeStatus is declared once in schema.prisma and reaches us through the generated Fee.
export type FeeStatus = components['schemas']['Fee']['status'];

type Fee = components['schemas']['Fee'];

// Returned by Fees.list — base Fee + the aggregate sum of its payments.
// `outstanding = Number(amount) - Number(paid)` is computed at render time.
export type FeeRow = components['schemas']['PaginatedFeeRow']['items'][number];

export type FeeDetail = components['schemas']['FeeDetail'];

// No sessionId on CreateFeeDto, so none here — session-linked fees come from
// Fees.generateSession, which sets it server-side.
type CreateFeeInput = components['schemas']['CreateFeeDto'];
type UpdateFeeInput = components['schemas']['UpdateFeeDto'];

type GenerateMonthlyFeesInput = components['schemas']['GenerateMonthlyFeesDto'];
type GenerateSessionFeesInput = components['schemas']['GenerateSessionFeesDto'];
export type GenerateFeesResult = components['schemas']['GenerateResult'];

/** OUTSTANDING is UNPAID + PARTIAL — a query value, not a fee state. See the backend DTO. */
export type FeeStatusFilter = FeeStatus | 'OUTSTANDING';

/** One enrolled trainee with no fee for the period — what generate-monthly would create. */
export type UnbilledEntry = components['schemas']['UnbilledFeeList'][number];

interface FeeListFilters {
  status?: FeeStatusFilter;
  classId?: string;
  traineeId?: string;
  periodStartFrom?: string;
  periodStartTo?: string;
}

export type Payment = components['schemas']['Payment'];

type CreatePaymentInput = components['schemas']['CreatePaymentDto'];

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => [k, String(v)] as [string, string]);
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

// Customer-portal payload — fees enriched with class + trainee + full payments[].
// Server-side filtered to trainees the customer owns/guards.
export type CustomerFeeEntry = components['schemas']['CustomerFeeEntryList'][number];

export const Fees = {
  list: (filters: FeeListFilters & PageParams = {}) =>
    apiRequest<PaginatedResult<FeeRow>>(
      `/fees${buildQuery({ ...filters } as Record<string, unknown>)}`,
    ),
  unbilled: (params: { classId?: string; periodStart: string; periodEnd: string }) =>
    apiRequest<UnbilledEntry[]>(`/fees/unbilled${buildQuery(params)}`),
  myFees: () => apiRequest<CustomerFeeEntry[]>('/me/fees'),
  get: (id: string) => apiRequest<FeeDetail>(`/fees/${id}`),
  create: (input: CreateFeeInput) =>
    apiRequest<Fee>('/fees', { method: 'POST', body: input }),
  update: (id: string, input: UpdateFeeInput) =>
    apiRequest<Fee>(`/fees/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/fees/${id}`, { method: 'DELETE' }),
  generateMonthly: (input: GenerateMonthlyFeesInput) =>
    apiRequest<GenerateFeesResult>('/fees/generate-monthly', {
      method: 'POST',
      body: input,
    }),
  generateSession: (input: GenerateSessionFeesInput) =>
    apiRequest<GenerateFeesResult>('/fees/generate-session', {
      method: 'POST',
      body: input,
    }),
};

export const Payments = {
  record: (feeId: string, input: CreatePaymentInput) =>
    apiRequest<Payment>(`/fees/${feeId}/payments`, { method: 'POST', body: input }),
  remove: (feeId: string, id: string) =>
    apiRequest<void>(`/fees/${feeId}/payments/${id}`, { method: 'DELETE' }),
};

// Dashboard sums are numbers by design: DashboardService aggregates and rounds each bucket,
// and the chart computes on them. Per-row amounts stay strings — see FeeRow above.
export type FeesSummaryEntry = components['schemas']['FeesSummaryEntryList'][number];
export type CashflowSummaryEntry = components['schemas']['CashflowSummaryEntryList'][number];
export const Dashboard = {
  feesSummary: (params: { from?: string; to?: string } = {}) =>
    apiRequest<FeesSummaryEntry[]>(`/dashboard/fees-summary${buildQuery(params)}`),
  cashflowSummary: (params: { from?: string; to?: string } = {}) =>
    apiRequest<CashflowSummaryEntry[]>(`/dashboard/cashflow-summary${buildQuery(params)}`),
};

export const Auth = {
  forgotPassword: (email: string) =>
    apiRequest<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      unauthenticated: true,
    }),
  resetPassword: (input: { token: string; newPassword: string }) =>
    apiRequest<void>('/auth/reset-password', {
      method: 'POST',
      body: input,
      unauthenticated: true,
    }),
};
