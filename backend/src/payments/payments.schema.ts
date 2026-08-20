import { z } from 'zod';
import { decimalString, isoDate } from '@/common/response-schema';

export const PaymentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  feeId: z.string(),
  amount: decimalString,
  paidAt: isoDate,
  method: z.string().nullable(),
  notes: z.string().nullable(),
  // Audit pointer plus denormalized snapshot — all nullable, the user may be gone.
  recordedById: z.string().nullable(),
  recordedByEmailSnapshot: z.string().nullable(),
  recordedByNameSnapshot: z.string().nullable(),
  createdAt: isoDate,
});

/** GET /fees/:feeId/payments stays a plain array, per the parent-scoped sub-list convention. */
export const PaymentListSchema = z.array(PaymentSchema);
