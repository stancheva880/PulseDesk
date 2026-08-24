import { PrismaLibSQL } from '@prisma/adapter-libsql/web';
import type { Prisma } from '@prisma/client';

/**
 * Where the database lives, decided from the environment.
 *
 * Two shapes, one schema. Locally, under `docker compose`, and in CI there is a SQLite **file** and
 * Prisma reaches it through `DATABASE_URL` on its own — this returns `{}` and nothing changes. On a
 * serverless host the filesystem is ephemeral, so the same SQLite dialect is reached over HTTP
 * instead, through Turso's libSQL adapter.
 *
 * The `/web` entry point, not the default one: the default `@prisma/adapter-libsql` pulls in
 * `@libsql/client`'s Node build, which loads a platform-specific native binary (`@libsql/linux-x64-gnu`)
 * via a dynamically-computed `require()`. Vercel's function bundler can't statically trace that, so it
 * gets pruned from the deployed Lambda and every request crashed with "Cannot find module
 * '@libsql/linux-x64-gnu'". `/web` uses `@libsql/client/web`, a pure HTTP/WebSocket implementation
 * with no native binary — exactly what a remote-only connection (no local file, no embedded replica)
 * needs.
 *
 * Deliberately the whole of the hosted-database change: `provider` stays `sqlite`, so the committed
 * migrations, `docker-compose.yml` and the CI workflow are untouched and the test suite keeps running
 * against a real file.
 */
export function prismaOptions(env: NodeJS.ProcessEnv): Prisma.PrismaClientOptions {
  const url = env.TURSO_DATABASE_URL?.trim();
  if (!url) return {};

  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!authToken) {
    throw new Error(
      'TURSO_DATABASE_URL is set but TURSO_AUTH_TOKEN is not. A remote libSQL database needs both; ' +
        'unset the URL to fall back to the local file in DATABASE_URL.',
    );
  }

  return { adapter: new PrismaLibSQL({ url, authToken }) };
}
