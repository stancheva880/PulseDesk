import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApiDocument } from './common/openapi-document';

// Emits the OpenAPI description of every route into backend/openapi.json, which
// frontend/lib/api-schema.d.ts is generated from. Run it via `npm run gen:api`, never
// directly: the @nestjs/swagger CLI plugin is a tsc transformer, so the DTO schemas only
// exist in dist/. Committed output — never hand-edit openapi.json.
//
// This module has no top-level side effects so the spec can import it; the entry point is
// generate-openapi-run.ts (same split as prisma/seed.ts + prisma/seed-run.ts).

// npm runs workspace scripts with cwd set to the package directory.
export const OPENAPI_PATH = path.resolve(process.cwd(), 'openapi.json');

export function bootFailureMessage(err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return [
    'Failed to boot the Nest application, so no OpenAPI spec was written.',
    'Generation needs a reachable, migrated database: check DATABASE_URL in backend/.env',
    'and run `prisma migrate deploy`.',
    `Cause: ${reason}`,
  ].join('\n');
}

export async function main(): Promise<void> {
  let app;
  try {
    app = await NestFactory.create(AppModule, { logger: false });
  } catch (err) {
    console.error(bootFailureMessage(err));
    process.exitCode = 1;
    return;
  }

  // Matches configureApp()'s prefix so the emitted paths are the real ones. The rest of
  // configureApp (helmet, CORS, ValidationPipe) is irrelevant to a document emit.
  app.setGlobalPrefix('api');

  const { document, attached } = buildOpenApiDocument(app);

  // Single write, after the document is complete — a partial spec is impossible.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- module constant, not user input
  writeFileSync(OPENAPI_PATH, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`Wrote ${OPENAPI_PATH} (${attached.length} response schemas: ${attached.join(', ')})`);
}
