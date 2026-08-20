/**
 * Ceiling for every money amount accepted over the API.
 *
 * Not a business limit — a guard so a mistyped extra zero and an unbounded value cannot reach a
 * `Decimal` column. Shared by the fee and payment DTOs so the two cannot drift; the frontend
 * carries the same number in `lib/utils.ts`.
 */
export const MAX_AMOUNT = 1_000_000;

/**
 * Floor for every money amount accepted over the API — one cent, so a zero-value fee or payment is
 * rejected. `@Min(0.01)` rather than `@IsPositive()` on purpose: the swagger plugin renders
 * `@IsPositive()` as `minimum: 1`, which would document a contract the validator does not enforce.
 */
export const MIN_AMOUNT = 0.01;
