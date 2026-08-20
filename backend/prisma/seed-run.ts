/**
 * Entry point for `npm run seed` (wired in prisma.config.ts) and for `npm run seed:data`.
 *
 * Exists only so `seed.ts` stays free of top-level side effects and can therefore be
 * imported by seed.spec.ts. Everything of substance lives in seed() / seedData().
 *
 * No arguments = the bootstrap seed, exactly as before; `prisma db seed` passes none and
 * cannot forward any. Flags = the on-demand generator, which is why seed:data runs
 * ts-node directly instead of going through Prisma.
 */
import { PrismaClient } from '@prisma/client';
// The seed must reach the same database as the app — including a hosted libSQL one,
// where PrismaClient needs the adapter rather than DATABASE_URL. See DEPLOY.md 1.4.
import { prismaOptions } from '../src/prisma/prisma-options';
import { seed } from './seed';
import { SEED_DATA_USAGE, parseSeedDataArgs, seedData } from './seed-data';

// `prisma db seed` gets .env from prisma.config.ts, which runs in the Prisma CLI process.
// A direct ts-node run has no such parent, so DATABASE_URL would be missing. This does
// not override an already-set variable, so an explicit `FOO=bar npm run ...` still wins.
try {
  process.loadEnvFile();
} catch {
  // .env may be absent in CI / fresh checkouts — that's fine.
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = args.length > 0 ? parseSeedDataArgs(args) : null;

  if (options?.help) {
    // eslint-disable-next-line no-console
    console.log(SEED_DATA_USAGE);
    return;
  }

  const prisma = new PrismaClient(prismaOptions(process.env));
  try {
    if (options) await seedData(prisma, options);
    else await seed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
