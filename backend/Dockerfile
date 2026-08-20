# syntax=docker/dockerfile:1
# Build context = repo root (the npm-workspaces lockfile lives there).
# Build a target explicitly:  docker build -f backend/Dockerfile --target prod .

# ---- base: shared runtime layer -------------------------------------------------
FROM node:24-slim AS base
# OpenSSL is required by Prisma's query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# NODE_ENV is intentionally NOT set to production here: npm ci omits devDependencies
# when NODE_ENV=production, and the build stages need them (@nestjs/cli, typescript).
COPY backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

# ---- deps: install all workspace deps (compiles native modules for Linux) --------
FROM base AS deps
# Toolchain for any native module (e.g. bcrypt) that lacks a prebuilt binary.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# npm ci needs the root manifest + lockfile and every workspace manifest.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

# ---- build: compile the backend + generate the Prisma client --------------------
FROM deps AS build
COPY backend ./backend
RUN cd backend && npx prisma generate
RUN npm run build --workspace backend

# ---- dev: hot-reload target (source arrives via bind mount in compose) -----------
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 4000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "run", "dev", "--workspace", "backend"]

# ---- prod: runtime image --------------------------------------------------------
FROM base AS prod
ENV NODE_ENV=production
# Full node_modules (incl. Prisma CLI + ts-node) so the entrypoint can run
# `migrate deploy` and the ts-node seed. Native modules are already compiled in build.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/prisma.config.ts ./backend/prisma.config.ts
COPY --from=build /app/backend/tsconfig.json ./backend/tsconfig.json
EXPOSE 4000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "backend/dist/main.js"]
