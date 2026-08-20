import { z } from 'zod';

// Shared result shape for bulk-generation endpoints (sessions, monthly/session fees).
export interface GenerateResult {
  created: number;
  skipped: number;
}

/** The response contract for the same shape. Published as the `GenerateResult` component. */
export const GenerateResultSchema = z.object({
  created: z.number(),
  skipped: z.number(),
});
