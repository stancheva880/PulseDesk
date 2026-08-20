// Deliberately dependency-free. `prisma/seed.ts` imports this by relative path under
// ts-node (CommonJS, no tsconfig-paths), so it can neither use the `@/` alias nor pull
// in anything from @nestjs/*.

const PLACEHOLDER_PATTERNS = [/^REPLACE_/i, /^dev-/i, /^change-me/i];

// True when the value is unset or still one of the templates in .env.example.
// Length floors stay with each caller: 32 chars is right for a 256-bit HMAC key and
// wrong for a human-chosen password, so a shared constant would be false economy.
export function looksLikePlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

// The seed's demo tenant/admin/teacher carry passwords hardcoded in its source, so they
// must never reach production. A named predicate rather than an inline comparison so the
// rule is testable without importing seed.ts, which runs main() on load.
export function shouldSeedDemoData(nodeEnv: string | undefined): boolean {
  return (nodeEnv ?? '').toLowerCase() !== 'production';
}
