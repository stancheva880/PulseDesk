import { z } from 'zod';
import {
  decimalString,
  isoDate,
  nullableIsoDate,
  paginatedSchema,
} from '@/common/response-schema';

// Every card row carries the derived visit counters so no caller re-computes them.
export const CardRowSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  traineeId: z.string(),
  // null = tenant-wide (visits usable for any class).
  classId: z.string().nullable(),
  // The purchase fee this card was billed through.
  feeId: z.string(),
  totalVisits: z.number().int(),
  price: decimalString,
  expiresAt: nullableIsoDate,
  cancelledAt: nullableIsoDate,
  visitsUsed: z.number().int(),
  visitsRemaining: z.number().int(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const PaginatedCardRowSchema = paginatedSchema(CardRowSchema);

// TKT-0116: what the portal shows — visits, expiry, scope, cancelled flag. No price or
// feeId: purchase internals stay staff-side.
export const CustomerCardEntrySchema = z.object({
  id: z.string(),
  traineeId: z.string(),
  totalVisits: z.number().int(),
  visitsUsed: z.number().int(),
  visitsRemaining: z.number().int(),
  expiresAt: nullableIsoDate,
  cancelledAt: nullableIsoDate,
  // null = tenant-wide ("whole club").
  class: z.object({ id: z.string(), name: z.string() }).nullable(),
  trainee: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
});

/** GET /me/cards stays a plain array, per the customer sub-list convention. */
export const CustomerCardEntryListSchema = z.array(CustomerCardEntrySchema);
