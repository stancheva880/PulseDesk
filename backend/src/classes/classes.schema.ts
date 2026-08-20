import { BillingMode } from '@prisma/client';
import { z } from 'zod';
import {
  isoDate,
  nullableDecimalString,
  paginatedSchema,
} from '@/common/response-schema';

// These schemas are the contract for the classes routes: the interceptor parses every
// response through them, and generate-openapi.ts turns the same objects into the OpenAPI
// response schemas the frontend types are generated from.

/**
 * The single declaration of the billing-mode union, derived from schema.prisma. Lives here
 * because this module owns the Class model; fees and sessions embed a class subset and import it.
 */
export const BillingModeSchema = z.enum(BillingMode);

export const ClassRowSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  billingMode: BillingModeSchema,
  monthlyAmount: nullableDecimalString,
  sessionPrice: nullableDecimalString,
  isActive: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const PaginatedClassRowSchema = paginatedSchema(ClassRowSchema);

export const ClassDetailSchema = ClassRowSchema.extend({
  // Exactly the two columns classes.service.ts selects. Declaring the full Location here is
  // the original defect this epic exists to make impossible.
  locations: z.array(z.object({ id: z.string(), name: z.string() })),
  trainers: z.array(
    z.object({
      id: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      email: z.string(),
    }),
  ),
  trainees: z.array(z.object({ id: z.string(), firstName: z.string(), lastName: z.string() })),
});
