import { z } from 'zod';
import { ClassRowSchema } from '@/classes/classes.schema';
import { isoDate, paginatedSchema } from '@/common/response-schema';
import { ContactPersonSchema } from '@/contacts/contacts.schema';
import { LocationSchema } from '@/locations/locations.schema';

export const TraineeSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  // A calendar day semantically, but stored as DateTime and already sent as a full ISO
  // timestamp — trainee-form.tsx slices it to YYYY-MM-DD for the date input. Narrowing it
  // here would be a wire change, not a contract.
  dateOfBirth: isoDate,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  // The trainee's own CUSTOMER login, if they have one.
  userId: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const PaginatedTraineeSchema = paginatedSchema(TraineeSchema);

export const TraineeDetailSchema = TraineeSchema.extend({
  // Included whole (`contacts: true` etc.), so every column stays part of the contract.
  contacts: z.array(ContactPersonSchema),
  locations: z.array(LocationSchema),
  classes: z.array(ClassRowSchema),
  // Narrowed by `select` — exactly these four columns.
  guardians: z.array(
    z.object({
      id: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      email: z.string(),
    }),
  ),
  // Narrowed by `select`, and null when no account is linked.
  user: z.object({ id: z.string(), email: z.string() }).nullable(),
});

// GET /me/trainees (trainees.service.ts's listForCustomer). A narrower row than TraineeSchema —
// built from a `select`, not the full model — since the portal has no use for tenantId, phone,
// notes, etc. `classes` is what tells "Деца" and "Класове" apart on the same payload: which
// classes each trainee is enrolled in, empty when there are none yet.
export const CustomerTraineeEntrySchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: isoDate,
  classes: z.array(
    z.object({ id: z.string(), name: z.string(), description: z.string().nullable() }),
  ),
});

export const CustomerTraineeEntryListSchema = z.array(CustomerTraineeEntrySchema);
