/**
 * Case-folding for substring search, done in application code because the database cannot.
 *
 * SQLite's `LIKE` is case-insensitive for ASCII only ("'a' LIKE 'A'" is TRUE, "'æ' LIKE 'Æ'" is
 * FALSE), its built-in `lower()` folds ASCII only, and Prisma's `mode: 'insensitive'` is
 * PostgreSQL/MongoDB. `COLLATE NOCASE` is ASCII-only too, needs a table rebuild, and is
 * provider-specific syntax this schema deliberately avoids. So the *query* is expanded instead:
 * OR the variants a name is plausibly stored in. Latin queries collapse to fewer variants and
 * `LIKE` handles their casing anyway.
 *
 * ponytail: misses mid-word capitals — `макдоналд` will not find `МакДоналд`. The upgrade path is
 * a normalized lowercase column written on every create/update, and on Postgres the whole helper
 * is deleted in favour of `mode: 'insensitive'`. Recorded in PRD-0011 §7 and RES-0003 §§14-18.
 */
export function searchVariants(query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const lower = trimmed.toLocaleLowerCase();
  const capitalized = lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
  return [...new Set([trimmed, lower, trimmed.toLocaleUpperCase(), capitalized])];
}
