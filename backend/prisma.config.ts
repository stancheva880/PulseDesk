import { defineConfig } from 'prisma/config';

// Prisma 6.13+ no longer auto-loads .env when a config file is present.
// Re-instate the load here so DATABASE_URL etc. are available to the schema engine.
try {
  process.loadEnvFile();
} catch {
  // .env may be absent in CI / fresh checkouts — that's fine.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'ts-node --compiler-options {"module":"CommonJS"} prisma/seed.ts',
  },
});