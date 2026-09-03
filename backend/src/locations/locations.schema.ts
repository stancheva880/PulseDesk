import { z } from 'zod';
import { isoDate, paginatedSchema } from '@/common/response-schema';

// Added by TKT-0044 because TraineeDetail embeds whole Location rows — defining the shape once
// here beats duplicating seven fields inside trainees.schema.ts. TKT-0050 owns the locations
// routes and will decorate them with this schema and alias the frontend type.
export const LocationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
  // Where customers send money for a fee here. All independently optional — a club fills
  // in whichever it actually offers.
  bankIban: z.string().nullable(),
  bankAccountHolder: z.string().nullable(),
  revolutHandle: z.string().nullable(),
  paypalEmail: z.string().nullable(),
  cashNote: z.string().nullable(),
});

export const PaginatedLocationSchema = paginatedSchema(LocationSchema);

/**
 * How other modules embed a location: the two columns their `select`s actually name.
 *
 * Declared separately rather than as `LocationSchema.pick(...)` at a call site, so "a location"
 * and "a reference to a location" are two named shapes that cannot be mistaken for each other.
 * Mistaking them is the `ClassDetail.locations` defect PRD-0008 exists to make impossible.
 *
 * Referenced only from inside other schemas, so `z.toJSONSchema` inlines it — it is deliberately
 * not a published component.
 */
export const LocationRefSchema = z.object({ id: z.string(), name: z.string() });

// GET /me/locations (locations.service.ts's listPaymentDetailsForCustomer) — the portal's
// Payment details tab. Narrowed by `select`, not the full LocationSchema: the portal has no
// use for tenantId/address/isActive/timestamps, only the identity + the payment fields.
export const CustomerLocationPaymentEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  bankIban: z.string().nullable(),
  bankAccountHolder: z.string().nullable(),
  revolutHandle: z.string().nullable(),
  paypalEmail: z.string().nullable(),
  cashNote: z.string().nullable(),
});

export const CustomerLocationPaymentEntryListSchema = z.array(CustomerLocationPaymentEntrySchema);
