import { apiRequest } from './api';

// Shared shapes — mirror the Prisma rows the backend returns. We keep these intentionally
// loose (not generated from schema) since Phase 2 only consumes a small slice.

export interface Location {
  id: string;
  tenantId: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BillingMode = 'PER_MONTH' | 'PER_SESSION';

export interface ClassRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  billingMode: BillingMode;
  // Prisma's Decimal serializes to a string in JSON.
  monthlyAmount: string | null;
  sessionPrice: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClassDetail extends ClassRow {
  locations: Location[];
  trainers: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }>;
  trainees: Array<{ id: string; firstName: string; lastName: string }>;
}

export type ContactRelationship = 'PARENT' | 'GUARDIAN' | 'GRANDPARENT' | 'SIBLING' | 'OTHER';

export interface ContactPerson {
  id: string;
  tenantId: string;
  traineeId: string;
  firstName: string;
  lastName: string;
  relationship: ContactRelationship;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Trainee {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  isActive: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TraineeDetail extends Trainee {
  contacts: ContactPerson[];
  locations: Location[];
  classes: ClassRow[];
  guardians: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }>;
  user: { id: string; email: string } | null;
}

// Inputs sent to the backend. Optional ID arrays use `?` so we can omit them on create.

export interface CreateLocationInput {
  name: string;
  address?: string;
}
export type UpdateLocationInput = Partial<CreateLocationInput> & { isActive?: boolean };

export interface CreateClassInput {
  name: string;
  description?: string;
  billingMode: BillingMode;
  monthlyAmount?: number;
  sessionPrice?: number;
  locationIds?: string[];
  traineeIds?: string[];
  trainerIds?: string[];
}
export type UpdateClassInput = Partial<Omit<CreateClassInput, 'billingMode'>> & {
  isActive?: boolean;
  // billingMode is immutable after creation — backend rejects changes; we never send it on update.
};

export interface ContactInput {
  firstName: string;
  lastName: string;
  relationship: ContactRelationship;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}

export interface CreateTraineeInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone?: string;
  email?: string;
  notes?: string;
  locationIds?: string[];
  classIds?: string[];
  contacts?: ContactInput[];
}
export type UpdateTraineeInput = Partial<Omit<CreateTraineeInput, 'contacts'>> & {
  isActive?: boolean;
};

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
}

export type AppUserRole = 'SUPER_ADMIN' | 'ADMIN' | 'EMPLOYEE' | 'CUSTOMER';

export interface UserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: AppUserRole;
  isActive: boolean;
  tenantId: string | null;
  createdAt: string;
  updatedAt: string;
  locations: Array<{ id: string; name: string }>;
}

export interface CreateUserInput {
  email: string;
  password: string;
  role: AppUserRole;
  firstName?: string;
  lastName?: string;
  locationIds?: string[];
}

export interface UpdateUserInput {
  firstName?: string | null;
  lastName?: string | null;
  isActive?: boolean;
  password?: string;
  role?: AppUserRole;
  locationIds?: string[];
}

export const Tenants = {
  list: () => apiRequest<TenantSummary[]>('/tenants'),
};

export const Users = {
  list: () => apiRequest<UserRow[]>('/users'),
  listSuperAdmins: () => apiRequest<UserRow[]>('/users/super-admins'),
  get: (id: string) => apiRequest<UserRow>(`/users/${id}`),
  create: (input: CreateUserInput) =>
    apiRequest<UserRow>('/users', { method: 'POST', body: input }),
  update: (id: string, input: UpdateUserInput) =>
    apiRequest<UserRow>(`/users/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/users/${id}`, { method: 'DELETE' }),
};

export const Locations = {
  list: () => apiRequest<Location[]>('/locations'),
  get: (id: string) => apiRequest<Location>(`/locations/${id}`),
  create: (input: CreateLocationInput) =>
    apiRequest<Location>('/locations', { method: 'POST', body: input }),
  update: (id: string, input: UpdateLocationInput) =>
    apiRequest<Location>(`/locations/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/locations/${id}`, { method: 'DELETE' }),
};

export const Classes = {
  list: () => apiRequest<ClassRow[]>('/classes'),
  get: (id: string) => apiRequest<ClassDetail>(`/classes/${id}`),
  create: (input: CreateClassInput) =>
    apiRequest<ClassRow>('/classes', { method: 'POST', body: input }),
  update: (id: string, input: UpdateClassInput) =>
    apiRequest<ClassRow>(`/classes/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/classes/${id}`, { method: 'DELETE' }),
};

export const Trainees = {
  list: () => apiRequest<Trainee[]>('/trainees'),
  get: (id: string) => apiRequest<TraineeDetail>(`/trainees/${id}`),
  create: (input: CreateTraineeInput) =>
    apiRequest<Trainee>('/trainees', { method: 'POST', body: input }),
  update: (id: string, input: UpdateTraineeInput) =>
    apiRequest<Trainee>(`/trainees/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/trainees/${id}`, { method: 'DELETE' }),
};

export const Contacts = {
  list: (traineeId: string) =>
    apiRequest<ContactPerson[]>(`/trainees/${traineeId}/contacts`),
  create: (traineeId: string, input: ContactInput) =>
    apiRequest<ContactPerson>(`/trainees/${traineeId}/contacts`, {
      method: 'POST',
      body: input,
    }),
  remove: (traineeId: string, id: string) =>
    apiRequest<void>(`/trainees/${traineeId}/contacts/${id}`, { method: 'DELETE' }),
};

// === Phase 3 — Sessions, Schedules, Attendances ===

export type SessionStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
export type AttendanceStatus = 'PENDING' | 'PRESENT' | 'ABSENT' | 'EXCUSED';
export type AttendanceRsvp = 'CONFIRMED' | 'DECLINED' | 'RESCHEDULE_REQUESTED';
export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface SessionRow {
  id: string;
  tenantId: string;
  classId: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  status: SessionStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDetail extends SessionRow {
  class: { id: string; name: string; billingMode: BillingMode };
  location: { id: string; name: string };
  trainers: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }>;
}

export interface CreateSessionInput {
  classId: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  notes?: string;
  trainerIds?: string[];
}
export type UpdateSessionInput = Partial<Omit<CreateSessionInput, 'classId'>> & {
  status?: SessionStatus;
};

export interface ClassSchedule {
  id: string;
  tenantId: string;
  classId: string;
  locationId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClassScheduleInput {
  classId: string;
  locationId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
}
export type UpdateClassScheduleInput = Partial<CreateClassScheduleInput> & {
  isActive?: boolean;
};

export interface GenerateSessionsInput {
  from: string;
  to: string;
  classId?: string;
}
export interface GenerateSessionsResult {
  created: number;
  skipped: number;
}

export interface Attendance {
  id: string;
  tenantId: string;
  sessionId: string;
  traineeId: string;
  status: AttendanceStatus;
  traineeRsvp: AttendanceRsvp | null;
  notes: string | null;
  markedAt: string | null;
  markedById: string | null;
  markedByEmailSnapshot: string | null;
  markedByNameSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BulkMarkAttendanceItem {
  traineeId: string;
  status: AttendanceStatus;
  notes?: string;
}
export interface BulkMarkAttendancesInput {
  items: BulkMarkAttendanceItem[];
}
export interface BulkMarkResult {
  updated: number;
}

export interface RsvpInput {
  traineeId: string;
  traineeRsvp: AttendanceRsvp;
}

export const Sessions = {
  list: () => apiRequest<SessionRow[]>('/sessions'),
  get: (id: string) => apiRequest<SessionDetail>(`/sessions/${id}`),
  create: (input: CreateSessionInput) =>
    apiRequest<SessionRow>('/sessions', { method: 'POST', body: input }),
  update: (id: string, input: UpdateSessionInput) =>
    apiRequest<SessionRow>(`/sessions/${id}`, { method: 'PATCH', body: input }),
  remove: (id: string) => apiRequest<void>(`/sessions/${id}`, { method: 'DELETE' }),
};

export const ClassSchedules = {
  list: () => apiRequest<ClassSchedule[]>('/class-schedules'),
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
// for trainees the customer owns/guards (server-side filtered).
export interface CustomerSessionEntry extends SessionRow {
  class: { id: string; name: string };
  location: { id: string; name: string };
  attendances: Array<
    Attendance & { trainee: { id: string; firstName: string; lastName: string } }
  >;
}

export const Attendances = {
  listForSession: (sessionId: string) =>
    apiRequest<Attendance[]>(`/sessions/${sessionId}/attendances`),
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

export type FeeStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface Fee {
  id: string;
  tenantId: string;
  classId: string;
  traineeId: string;
  sessionId: string | null;
  // Decimals serialize as strings.
  amount: string;
  status: FeeStatus;
  periodStart: string;
  periodEnd: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

// Returned by Fees.list — base Fee + the aggregate sum of its payments.
// `outstanding = Number(amount) - Number(paid)` is computed at render time.
export interface FeeRow extends Fee {
  paid: string;
}

export interface FeeDetail extends Fee {
  class: { id: string; name: string; billingMode: BillingMode };
  trainee: { id: string; firstName: string; lastName: string };
  payments: Payment[];
}

export interface CreateFeeInput {
  classId: string;
  traineeId: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
  sessionId?: string;
  notes?: string;
}
export type UpdateFeeInput = Partial<{
  amount: number;
  periodStart: string;
  periodEnd: string;
  notes: string;
}>;

export interface GenerateMonthlyFeesInput {
  periodStart: string;
  periodEnd: string;
  classId?: string;
}
export interface GenerateSessionFeesInput {
  from: string;
  to: string;
  classId?: string;
}
export interface GenerateFeesResult {
  created: number;
  skipped: number;
}

export interface FeeListFilters {
  status?: FeeStatus;
  classId?: string;
  traineeId?: string;
  periodStartFrom?: string;
  periodStartTo?: string;
}

export interface Payment {
  id: string;
  tenantId: string;
  feeId: string;
  amount: string;
  paidAt: string;
  method: string | null;
  notes: string | null;
  recordedById: string | null;
  recordedByEmailSnapshot: string | null;
  recordedByNameSnapshot: string | null;
  createdAt: string;
}

export interface CreatePaymentInput {
  amount: number;
  paidAt: string;
  method?: string;
  notes?: string;
}

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => [k, String(v)] as [string, string]);
  if (entries.length === 0) return '';
  return `?${new URLSearchParams(entries).toString()}`;
}

// Customer-portal payload — fees enriched with class + trainee + full payments[].
// Server-side filtered to trainees the customer owns/guards.
export interface CustomerFeeEntry extends Fee {
  class: { id: string; name: string };
  trainee: { id: string; firstName: string; lastName: string };
  payments: Payment[];
}

export const Fees = {
  list: (filters: FeeListFilters = {}) =>
    apiRequest<FeeRow[]>(`/fees${buildQuery({ ...filters } as Record<string, unknown>)}`),
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
  listForFee: (feeId: string) =>
    apiRequest<Payment[]>(`/fees/${feeId}/payments`),
  record: (feeId: string, input: CreatePaymentInput) =>
    apiRequest<Payment>(`/fees/${feeId}/payments`, { method: 'POST', body: input }),
  remove: (feeId: string, id: string) =>
    apiRequest<void>(`/fees/${feeId}/payments/${id}`, { method: 'DELETE' }),
};

export interface FeesSummaryEntry {
  period: string;
  collected: number;
  pending: number;
}
export interface CashflowSummaryEntry {
  period: string;
  collected: number;
  billed: number;
}
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
