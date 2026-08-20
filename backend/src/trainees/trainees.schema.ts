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
