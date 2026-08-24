# syntax=docker/dockerfile:1
# Build context = repo root (the npm-workspaces lockfile lives there).
# Build a target explicitly:  docker build -f frontend/Dockerfile --target prod .

# ---- base -----------------------------------------------------------------------
FROM node:24-slim AS base
WORKDIR /app
# NODE_ENV is intentionally NOT set to production here: npm ci omits devDependencies
# when NODE_ENV=production, and `next build` needs them (typescript, tailwind, postcss).

# ---- deps: install all workspace deps -------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci

# ---- build: produce the standalone Next.js server -------------------------------
FROM deps AS build
# NEXT_PUBLIC_* are inlined into the client bundle at build time. The value must be
# what the *browser* uses to reach the API (host-mapped port on a single host).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_DEFAULT_LOCALE=bg
# Empty = frontend error tracking off, which is the default. Because it is inlined here, the
# runtime environment cannot switch it on later — enabling it is a rebuild, not a restart.
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_DEFAULT_LOCALE=$NEXT_PUBLIC_DEFAULT_LOCALE
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
COPY frontend ./frontend
RUN npm run build --workspace frontend

# ---- dev: hot-reload target (source arrives via bind mount in compose) -----------
FROM deps AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev", "--workspace", "frontend"]

# ---- prod: runtime image (standalone server) ------------------------------------
FROM base AS prod
ENV NODE_ENV=production
ENV PORT=3000
# Bind all interfaces; the standalone server defaults to localhost otherwise.
ENV HOSTNAME=0.0.0.0
# Standalone is traced from the monorepo root, so it preserves the frontend/ path
# and carries its own minimal node_modules + server.js.
COPY --from=build /app/frontend/.next/standalone ./
# Static assets and public/ are not part of standalone and must be copied alongside.
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public
EXPOSE 3000
CMD ["node", "frontend/server.js"]
