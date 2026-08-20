import { z } from 'zod';

// Deliberate exception to the epic's Decimal-as-string rule: DashboardService already
// aggregates and rounds each bucket to a JS number (`Number(fee.amount)` then `round2()`),
// and the Recharts view does arithmetic on the result. Declaring these as strings would be a
// wire-format change, not a refactor. Every *per-row* amount stays a string — see
// fees.schema.ts.

export const FeesSummaryEntrySchema = z.object({
  period: z.string(),
  collected: z.number(),
  pending: z.number(),
});

export const CashflowSummaryEntrySchema = z.object({
  period: z.string(),
  collected: z.number(),
  billed: z.number(),
});

export const FeesSummaryEntryListSchema = z.array(FeesSummaryEntrySchema);
export const CashflowSummaryEntryListSchema = z.array(CashflowSummaryEntrySchema);
