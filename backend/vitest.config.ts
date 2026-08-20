import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // prisma/ is included so seed.spec.ts is discovered. Safe only because seed.ts has
    // no top-level side effects (its entry point is prisma/seed-run.ts).
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts'],
    root: './',
    // SQLite is the dev/test DB and serializes writes — under high parallelism the
    // Nest e2e specs (which all hit the same dev.db) contend on locks and time out.
    // Cap to 4 forks: keeps wall time reasonable but avoids the contention spike.
    pool: 'forks',
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
