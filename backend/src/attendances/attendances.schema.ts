import { AttendanceRsvp, AttendanceStatus } from '@prisma/client';
import { z } from 'zod';
import { isoDate, nullableIsoDate } from '@/common/response-schema';
import { LocationRefSchema } from '@/locations/locations.schema';
import { SessionSchema } from '@/sessions/sessions.schema';

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

// listCustomerSessions returns whole Session rows, so this extends the sessions contract rather
// than restating it — the portal cannot describe a session differently from GET /sessions.
export const CustomerSessionEntrySchema = SessionSchema.extend({
  // The portal gets the class name only — no billing mode.
  class: z.object({ id: z.string(), name: z.string() }),
  location: LocationRefSchema,
  // Server-side filtered to the customer's own trainees; the schema describes the result, not
  // the filter.
  attendances: z.array(AttendanceWithTraineeSchema),
});

export const CustomerSessionEntryListSchema = z.array(CustomerSessionEntrySchema);
