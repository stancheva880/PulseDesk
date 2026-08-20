import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Money is rendered as plain `amount + currency`, deliberately not Intl — the fee
// screens and their specs expect this exact text.
export function formatMoney(amount: number | string, currency: string): string {
  return `${Number(amount).toFixed(2)} ${currency}`;
}

// Not a business limit — a guard so a mistyped extra zero and an unbounded value cannot reach a
// Decimal column. One constant, easy to move.
export const MAX_AMOUNT = 1_000_000;

// Decimal places are counted in the text, not in the number: 0.07 * 100 is 7.000000000000001 in
// binary floating point, so an arithmetic check rejects amounts that are perfectly valid. A digit
// pattern is exact and also does the work of rejecting '', 'abc', '1e3', '+5' and '-5'.
const AMOUNT_TEXT = /^(\d+(\.\d{1,2})?|\.\d{1,2})$/;

/**
 * The one money-input rule for the fee screens: a positive amount, at most two decimal places, at
 * most MAX_AMOUNT. Returns null when the text is not that, so a caller renders one message.
 *
 * The three fee forms each had their own version of this and disagreed — create demanded > 0,
 * fee-edit accepted >= 0 (so an empty box saved a zero fee, because `Number('')` is 0), and none
 * of them rejected a third decimal place that the DTO would then have refused anyway. The two
 * decimal places make the smallest accepted value 0.01, which is the API's MIN_AMOUNT.
 */
export function parseAmount(raw: string): number | null {
  const text = raw.trim();
  if (!AMOUNT_TEXT.test(text)) return null;
  const n = Number(text);
  return n > 0 && n <= MAX_AMOUNT ? n : null;
}

// Locale-aware "Mar 05, 2026, 18:00"-style stamp used by session lists.
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
