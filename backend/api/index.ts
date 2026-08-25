/**
 * Serverless entry point (Vercel) — thin require() shim.
 *
 * The real handler lives at `src/vercel-handler.ts` and is loaded here from its COMPILED `dist/`
 * output, deliberately via `require()` and not `import '../src/vercel-handler'`. See that file's
 * docblock for why: Vercel's Node.js function bundler does not resolve the `@/*` path alias used
 * throughout `src/`, but `nest build`'s own `tsc` builder already rewrites it to relative paths in
 * `dist/`.
 *
 * `require()`, not `import`, is deliberate too: `@types/node` types it as `(id: string) => any`,
 * so `tsc --noEmit` never needs `dist/` to exist to typecheck this file. An `import` statement
 * would instead fail `npm run typecheck` on a fresh clone and in CI, where typecheck runs before
 * `nest build` produces `dist/`.
 *
 * The filename is plain `index.ts`, not an optional catch-all bracket name — that Next.js-style
 * convention is not reliably honored by Vercel's generic Node.js function builder outside a
 * Next.js project. Every route this app serves is instead funneled here by the `"rewrites"` entry
 * in vercel.json (`/api/:path*` -> `/api`). Vercel's Node.js functions receive the request's
 * original, unmodified `req.url` path regardless of the rewrite destination, so Nest's own router
 * still sees and dispatches the real path — the rewrite only selects which function handles the
 * request. It is not free of side effects, though: because the destination doesn't reference
 * `:path*`, Vercel appends the captured value as a `path` query-string param on every request.
 * `app-setup.ts`'s `configureApp()` strips it before validation runs — see the comment there.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see docblock above
module.exports = require('../dist/vercel-handler.js');
