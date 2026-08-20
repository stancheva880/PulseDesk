/**
 * Apply the committed Prisma migrations to a Turso (libSQL) database.
 *
 * `prisma migrate deploy` cannot talk to Turso, so this takes its place for the hosted database
 * only. Nothing else changes: the schema stays `provider = "sqlite"`, the files under
 * prisma/migrations/ are the same ones `migrate deploy` applies to the local file and in CI, and
 * this script never edits them.
 *
 * Applied migrations are recorded in `_turso_migrations`, so the script is idempotent — run it after
 * every deploy that adds a migration and it applies only what is new.
 *
 * Usage (PowerShell):
 *   $env:TURSO_DATABASE_URL="libsql://...";  $env:TURSO_AUTH_TOKEN="..."
 *   node scripts/turso-migrate.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
if (!url || !authToken) {
  console.error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before running this.');
  process.exit(1);
}

const migrationsDir = path.join(import.meta.dirname, '..', 'prisma', 'migrations');
const client = createClient({ url, authToken });

await client.execute(
  'CREATE TABLE IF NOT EXISTS _turso_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
);
const done = new Set(
  (await client.execute('SELECT name FROM _turso_migrations')).rows.map((r) => String(r.name)),
);

// Directory names are timestamp-prefixed, so sorting them by name is chronological order.
const entries = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let applied = 0;
for (const name of entries) {
  if (done.has(name)) {
    console.log(`skip  ${name}`);
    continue;
  }
  const sql = await readFile(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
  // executeMultiple, not a transaction: Prisma's table-rebuild migrations carry PRAGMA statements,
  // which SQLite refuses to run inside one.
  await client.executeMultiple(sql);
  await client.execute({
    sql: 'INSERT INTO _turso_migrations (name, applied_at) VALUES (?, ?)',
    args: [name, new Date().toISOString()],
  });
  console.log(`apply ${name}`);
  applied += 1;
}

console.log(`\n${applied} applied, ${entries.length - applied} already present.`);
client.close();
