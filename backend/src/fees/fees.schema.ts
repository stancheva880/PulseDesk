import { FeeStatus } from '@prisma/client';
import { z } from 'zod';
import { BillingModeSchema } from '@/classes/classes.schema';
import { decimalString, isoDate, paginatedSchema } from '@/common/response-schema';
import { PaymentSchema } from '@/payments/payments.schema';

// The money contract. Every amount is a Prisma Decimal that reaches the wire as a string —
// z.number() on an amount would turn "120.00" into 120 for every caller, and both the fees
// table and the chart read the string form.

/** The single declaration of the status union, derived from schema.prisma. */
export const FeeStatusSchema = z.enum(FeeStatus);

export const FeeSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  classId: z.string(),
  traineeId: z.string(),
  // Set only for PER_SESSION fees, by generateSessionFees.
  sessionId: z.string().nullable(),
  periodStart: isoDate,
  periodEnd: isoDate,
  amount: decimalString,
  status: FeeStatusSchema,
  notes: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

/** What list() returns: the fee plus the aggregate sum of its payments, defaulted to '0'. */
export const FeeRowSchema = FeeSchema.extend({ paid: decimalString });

export const PaginatedFeeRowSchema = paginatedSchema(FeeRowSchema);

export const FeeDetailSchema = FeeSchema.extend({
  class: z.object({ id: z.string(), name: z.string(), billingMode: BillingModeSchema }),
  trainee: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
  payments: z.array(PaymentSchema),
});

/** The customer portal gets the class name only — no billing mode. */
export const CustomerFeeEntrySchema = FeeSchema.extend({
  class: z.object({ id: z.string(), name: z.string() }),
  trainee: z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
  payments: z.array(PaymentSchema),
});

/** GET /me/fees stays a plain array, per the parent-scoped/customer sub-list convention. */
export const CustomerFeeEntryListSchema = z.array(CustomerFeeEntrySchema);

/** GET /fees/unbilled — the gaps generate-monthly would fill, reported not created. */
export const UnbilledFeeListSchema = z.array(
  z.object({
    classId: z.string(),
    className: z.string(),
    traineeId: z.string(),
    traineeFirstName: z.string(),
    traineeLastName: z.string(),
    amount: decimalString,
  }),
);

/**
 * Shared by both bulk-generate routes here and by class-schedules' generate-sessions, so it
 * lives beside the interface it mirrors. Re-exported to keep this module's import path.
 */
export { GenerateResultSchema } from '@/common/generate-result';
