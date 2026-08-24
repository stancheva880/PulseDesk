/**
 * `@prisma/adapter-libsql/web` has no type declarations `tsconfig.json`'s `moduleResolution: "node"`
 * can see — the package only exposes them through its `package.json` `exports` map, which needs
 * `"node16"`/`"nodenext"`/`"bundler"` resolution to read. Switching the whole project's
 * `moduleResolution` for one import is out of scope here, so this re-exports the same `PrismaLibSQL`
 * shape from the package's default entry point, whose `.d.ts` resolves normally. See
 * `src/prisma/prisma-options.ts` for why the `/web` entry point is used at runtime.
 */
declare module '@prisma/adapter-libsql/web' {
  export { PrismaLibSQL } from '@prisma/adapter-libsql';
}
