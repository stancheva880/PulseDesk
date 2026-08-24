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
 * The filename is an optional catch-all on purpose. Every route this app serves lives under the
 * global `api` prefix, so `api/[[...path]].ts` collects all of them through Vercel's own filesystem
 * routing and the request arrives with its original URL. A single-file `api/index.ts` plus a
 * `"rewrites"` entry in vercel.json would hand Nest the rewritten path instead — `/api` for every
 * request — and every route would 404.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- see docblock above
module.exports = require('../dist/vercel-handler.js');
