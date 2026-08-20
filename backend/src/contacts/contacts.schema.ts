import { ContactRelationship } from '@prisma/client';
import { z } from 'zod';
import { isoDate } from '@/common/response-schema';

/** The single declaration of the relationship union, derived from schema.prisma. */
export const ContactRelationshipSchema = z.enum(ContactRelationship);

export const ContactPersonSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  traineeId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  relationship: ContactRelationshipSchema,
  phone: z.string().nullable(),
  email: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** The contacts sub-list stays a plain array, per the parent-scoped convention. */
export const ContactPersonListSchema = z.array(ContactPersonSchema);
