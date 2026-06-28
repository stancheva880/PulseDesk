#!/bin/sh
# Backend container entrypoint. One script for both dev and prod; behaviour is
# toggled by env vars so the same logic serves every target.
#
#   RUN_MIGRATIONS  apply committed migrations on boot   (default: true)
#   RUN_SEED        run the idempotent seed on boot      (default: false)
#   NODE_ENV        "production" skips the dev-only prisma generate
#
# Prisma commands run from backend/ so prisma.config.ts (schema + seed wiring) is found.
set -e

# In dev the Prisma client lives in the anonymous node_modules volume and must be
# (re)generated on each fresh container. In prod it is already generated in the image.
if [ "$NODE_ENV" != "production" ]; then
  echo "[entrypoint] prisma generate"
  ( cd /app/backend && npx prisma generate )
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy"
  ( cd /app/backend && npx prisma migrate deploy )
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] prisma db seed (idempotent)"
  ( cd /app/backend && npx prisma db seed )
fi

# Hand off to the container CMD (nest --watch in dev, node dist/main.js in prod).
# Run from the repo root so `npm run ... --workspace backend` resolves correctly.
cd /app
exec "$@"
