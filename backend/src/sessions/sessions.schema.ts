import { SessionStatus } from '@prisma/client';
import { z } from 'zod';
import { BillingModeSchema, WaitlistModeSchema } from '@/classes/classes.schema';
import { isoDate, paginatedSchema } from '@/common/response-schema';
import { LocationRefSchema } from '@/locations/locations.schema';

// The sessions contract. Unlike the HH:MM wall-clock strings in class-schedules, startsAt and
// endsAt are real instants: isoDate transforms each Date to exactly the string
// JSON.stringify already produced (Date.prototype.toJSON → toISOString). dashboard/page.tsx
// counts this week's sessions with `new Date(r.startsAt)`, so a changed format would miscount
// silently rather than throw — hence the literal-string assertions in the spec.

/** The single declaration of the status union, derived from schema.prisma. */
export const SessionStatusSchema = z.enum(SessionStatus);

export const SessionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  classId: z.string(),
  locationId: z.string(),
  startsAt: isoDate,
  endsAt: isoDate,
  status: SessionStatusSchema,
  notes: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  // TKT-0103: present on list rows only (occupancy for the calendar's X/Y chips);
  // create/update return the bare row, hence optional.
  _count: z.object({ attendances: z.number().int() }).optional(),
});

export const PaginatedSessionSchema = paginatedSchema(SessionSchema);

// Exactly the three relation subsets sessions.service.ts:79-83 selects, and no more —
// .parse() strips anything a future include adds.
export const SessionDetailSchema = SessionSchema.extend({
  class: z.object({
    id: z.string(),
    name: z.string(),
    billingMode: BillingModeSchema,
    capacity: z.number().int().nullable(),
    // TKT-0112: the attendance page decides whether to offer the waitlist from this.
    waitlistMode: WaitlistModeSchema,
  }),
  location: LocationRefSchema,
  trainers: z.array(
    z.object({
      id: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      email: z.string(),
    }),
  ),
});
