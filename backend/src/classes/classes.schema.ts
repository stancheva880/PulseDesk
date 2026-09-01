import { BillingMode, WaitlistMode } from '@prisma/client';
import { z } from 'zod';
import {
  isoDate,
  nullableDecimalString,
  nullableIsoDate,
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

/** TKT-0112: same ownership rule — sessions embed it via their class subset. */
export const WaitlistModeSchema = z.enum(WaitlistMode);

// Shared by ClassRowSchema's own (optional) trainers and ClassDetailSchema's (required) one.
const TrainerRefSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string(),
});

export const ClassRowSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  billingMode: BillingModeSchema,
  monthlyAmount: nullableDecimalString,
  sessionPrice: nullableDecimalString,
  // TKT-0109: set when billingMode = PER_COURSE.
  courseStart: nullableIsoDate,
  courseEnd: nullableIsoDate,
  coursePrice: nullableDecimalString,
  capacity: z.number().int().nullable(),
  waitlistMode: WaitlistModeSchema,
  // TKT-0117: the self-booking pair.
  allowSelfBooking: z.boolean(),
  bookingCutoffMin: z.number().int().nullable(),
  isActive: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
  // List rows only (classes.service.ts's list()) — who's teaching, visible without opening the
  // class. create()/update() return the bare row, hence optional, same reasoning as Session's
  // own list-only trainers/_count.
  trainers: z.array(TrainerRefSchema).optional(),
});

export const PaginatedClassRowSchema = paginatedSchema(ClassRowSchema);

export const ClassDetailSchema = ClassRowSchema.extend({
  // Exactly the two columns classes.service.ts selects. Declaring the full Location here is
  // the original defect this epic exists to make impossible.
  locations: z.array(z.object({ id: z.string(), name: z.string() })),
  // Required here, unlike the base schema — findById() always includes it.
  trainers: z.array(TrainerRefSchema),
  trainees: z.array(z.object({ id: z.string(), firstName: z.string(), lastName: z.string() })),
});
