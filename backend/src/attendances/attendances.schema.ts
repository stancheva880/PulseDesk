import { AttendanceRsvp, AttendanceStatus } from '@prisma/client';
import { z } from 'zod';
import { WaitlistModeSchema } from '@/classes/classes.schema';
import { isoDate, nullableIsoDate, paginatedSchema } from '@/common/response-schema';
import { LocationRefSchema } from '@/locations/locations.schema';
import { SessionSchema } from '@/sessions/sessions.schema';
import { TraineeSchema } from '@/trainees/trainees.schema';

// The attendance contract. TKT-0038 widened the list response to carry the trainee's name
// because the page could not resolve names past the first 100 trainees; that subset had
// nothing protecting it, and this is what makes losing it fail a test instead of a trainer's
// screen.

/** The single declaration of the trainer-recorded status, derived from schema.prisma. */
export const AttendanceStatusSchema = z.enum(AttendanceStatus);

/**
 * The single declaration of the customer-side RSVP. Reachable through three routes —
 * PATCH /sessions/:id/rsvp, GET /sessions/:id/attendances and GET /me/sessions — which
 * resolves PRD-0008 §9: it is described, not deleted.
 */
export const AttendanceRsvpSchema = z.enum(AttendanceRsvp);

export const AttendanceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  sessionId: z.string(),
  traineeId: z.string(),
  status: AttendanceStatusSchema,
  // Independent of `status` — a row can be CONFIRMED by the customer and still PENDING here.
  traineeRsvp: AttendanceRsvpSchema.nullable(),
  notes: z.string().nullable(),
  // Every audit column is null until a trainer marks the row.
  markedAt: nullableIsoDate,
  markedById: z.string().nullable(),
  markedByEmailSnapshot: z.string().nullable(),
  markedByNameSnapshot: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

// Exactly the columns ATTENDANCE_WITH_TRAINEE selects. `trainee` is a required relation with
// onDelete: Cascade, so it is deliberately not nullable — that would weaken the contract.
export const AttendanceWithTraineeSchema = AttendanceSchema.extend({
  trainee: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
});

/** The session attendance list stays a plain array, per the parent-scoped sub-list convention. */
export const AttendanceWithTraineeListSchema = z.array(AttendanceWithTraineeSchema);

export const BulkMarkResultSchema = z.object({ updated: z.number() });

// TKT-0108: each candidate carries the card a booking would consume (same rule as
// consumption — null when none usable) and whether the trainee holds any card at all,
// so the picker warns ex-card-holders and only them.
export const CandidateTraineeSchema = TraineeSchema.extend({
  card: z
    .object({
      id: z.string(),
      visitsRemaining: z.number().int(),
      expiresAt: nullableIsoDate,
      classScoped: z.boolean(),
    })
    .nullable(),
  hasCards: z.boolean(),
});

// TKT-0103: the candidates page envelope plus how many spots the session still has —
// null when the class has no capacity.
export const AttendanceCandidatesSchema = paginatedSchema(CandidateTraineeSchema).extend({
  spotsLeft: z.number().int().nullable(),
});

// listCustomerSessions returns whole Session rows, so this extends the sessions contract rather
// than restating it — the portal cannot describe a session differently from GET /sessions.
export const CustomerSessionEntrySchema = SessionSchema.extend({
  // The portal gets the class name plus its self-booking policy (TKT-0118) and its waitlist mode
  // (TKT-0121) — no billing fields.
  class: z.object({
    id: z.string(),
    name: z.string(),
    allowSelfBooking: z.boolean(),
    bookingCutoffMin: z.number().int().nullable(),
    waitlistMode: WaitlistModeSchema,
  }),
  location: LocationRefSchema,
  // Server-side filtered to the customer's own trainees; the schema describes the result, not
  // the filter.
  attendances: z.array(AttendanceWithTraineeSchema),
  // TKT-0118: eligibility for the Book button. spotsLeft is computed server-side from the
  // class capacity (null = no limit); myTrainees = the customer's trainees enrolled in the class.
  spotsLeft: z.number().int().nullable(),
  myTrainees: z.array(
    z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
  ),
  // TKT-0121: which of them are queued on this session. Ids only — names come from myTrainees,
  // so a staff-queued off-roster trainee simply has no row to render.
  myWaitlist: z.array(z.string()),
});

export const CustomerSessionEntryListSchema = z.array(CustomerSessionEntrySchema);
