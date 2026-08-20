import { PrismaLibSQL } from '@prisma/adapter-libsql';
import type { Prisma } from '@prisma/client';

/**
 * Where the database lives, decided from the environment.
 *
 * Two shapes, one schema. Locally, under `docker compose`, and in CI there is a SQLite **file** and
 * Prisma reaches it through `DATABASE_URL` on its own — this returns `{}` and nothing changes. On a
 * serverless host the filesystem is ephemeral, so the same SQLite dialect is reached over HTTP
 * instead, through Turso's libSQL adapter.
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
