# PulseDesk

Multi-tenant SaaS for trainers, clubs and schools: trainees, classes, weekly schedules, sessions,
attendance, and billing — monthly, per-session and course fees, prepaid visit cards with refunds,
plus per-session waitlists with automatic or email-claim promotion and opt-in customer self-booking
(book, cancel and queue from the portal, behind a per-class deadline). NestJS + Prisma on the backend,
Next.js on the frontend, one npm-workspaces monorepo.

- **Using the app** — open `docs/index.html`. Non-technical guides per role, plus five worked
  business setups, in Bulgarian and English.
- **What it should do** — `PRD.md`.
- **Putting it on the internet** — `DEPLOY.md` (Vercel + Turso, domains, mail, error tracking).
- **Containers in detail** — `DOCKER.md`.
- **How the work was planned** — `.workflow/` (PRDs, tickets, research, tech plans).

## Requirements

- Node **>= 24** (`.nvmrc` pins 24) and npm 10+.
- Nothing global: Prisma, Nest and Next all run through `npx` / workspace scripts.
- Docker Desktop, only for the container path below.

## Run it locally

```bash
npm ci                                       # installs both workspaces from the root
cp backend/.env.example backend/.env         # then edit — see Environment below
cd backend
npx prisma generate                          # the client is needed by tsc and by the tests
npx prisma migrate deploy                    # creates backend/prisma/dev.db
cd ..
npm run seed                                 # SUPER_ADMIN + demo club (non-production only)
npm run dev                                  # backend :4000 and frontend :3000 together
```

- Backend: `http://localhost:4000/api` — every route lives under the `/api` prefix.
- Frontend: `http://localhost:3000`.
- Sign in with the `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` you put in `backend/.env`.

### The demo club

Outside production the seed also creates a demo club, populated well enough to walk through every
screen without entering anything by hand.

| | |
| --- | --- |
| Tenant | `Demo Sports Club` (slug `demo-sports-club`) |
| Location | `Central Hall` — **both staff accounts are assigned to it** |
| Classes | `Junior Judo` (billed per month, 80) and `Adult Conditioning` (billed per session, 15) |
| Trainees | 6 — three children in Junior Judo, each with a guardian contact, and three adults in Adult Conditioning |
| Schedule | 4 weekly slots: Judo Mon + Wed 17:00, Conditioning Tue + Thu 19:00 |
| Sessions | 12 — three weeks ending in the current one. Every weekly slot falls Mon–Thu and a session counts as completed once its end time has passed, so a seed run Mon–Thu leaves some upcoming; a run Fri–Sun leaves all twelve completed |
| Attendance | one row per trainee per session; past sessions are marked, upcoming ones are pending with a couple of RSVPs — so a Fri–Sun seed leaves none pending |
| Fees | 12 — nine monthly across three months plus three per-session. Six paid, one partial, five unpaid |

Four accounts. The three demo passwords are constants at the top of `backend/prisma/seed.ts`; the
super admin's comes from `SUPERADMIN_PASSWORD`. The seed prints none of them, and the demo values are
local-development only:

| Account | Role | Signs in to |
| --- | --- | --- |
| your `SUPERADMIN_EMAIL` | `SUPER_ADMIN` | everything; picks a tenant with the selector |
| `admin@demo.pulsedesk.local` | `ADMIN` | the full dashboard for the demo club |
| `teacher@demo.pulsedesk.local` | `EMPLOYEE` | their own classes, sessions and attendance |
| `parent@demo.pulsedesk.local` | `CUSTOMER` | `/portal` — the schedule and fees of the two children they guard |

The location assignment matters: an administrator or trainer reads only the locations assigned to
them, so an account without one signs in to empty trainee, fee and location lists. Every demo
trainee and class is attached to `Central Hall` for the same reason.

Re-running the seed is safe. It repairs the staff location assignment on a database seeded before
that rule existed, but it does **not** regenerate the demo domain data — it skips that entirely once
the club has classes. Sessions are anchored to the week the seed ran, so on a database seeded a while
ago they will all be in the past; delete `backend/prisma/dev.db`, re-run `prisma migrate deploy` and
seed again to get a fresh current week.

One thing stops the seed dead, on purpose:

- `SUPERADMIN_PASSWORD` is unset, shorter than 12 characters, or starts with `REPLACE_`, `dev-` or
  `change-me`.

`NODE_ENV=production` does not stop it. The run then creates the super admin only, skips the demo
club, its location, all three demo accounts and every row of demo domain data, and finishes with
`Demo data: skipped`.

`frontend/.env.local` is optional: `NEXT_PUBLIC_API_URL` falls back to `http://localhost:4000` in
code. Create it when the backend lives elsewhere:

```bash
printf 'NEXT_PUBLIC_API_URL=http://localhost:4000\n' > frontend/.env.local
```

## Environment

All of these live in `backend/.env` (template: `backend/.env.example`).

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | `file:./dev.db` for SQLite. The schema is written to stay portable to Postgres/MySQL. |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | hosted SQLite | Set **both** to reach SQLite over HTTP (Turso) instead of a file; they replace `DATABASE_URL`. URL set without the token = refuses to start (`src/prisma/prisma-options.ts`). Both empty = local file, so leave them empty in development. `prisma migrate deploy` cannot reach Turso — use `node scripts/turso-migrate.mjs`. See `DEPLOY.md` §1.2–1.3. |
| `JWT_ACCESS_SECRET` | yes | `openssl rand -base64 32`. Access tokens are JWTs; refresh tokens are opaque random values stored as a hash, so there is no refresh secret. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | no | Default `15m` / `7d`. |
| `CORS_ALLOWED_ORIGINS` | no | Comma-separated. Falls back to `FRONTEND_URL`, then `http://localhost:3000`. |
| `MAIL_TRANSPORT` | in production | `console` writes every mail (reset/invite/waitlist links included) to stdout; `smtp` sends them. Production accepts `smtp` only. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | with smtp | Ignored by the console transport. |
| `PASSWORD_RESET_TTL_HOURS` | no | Default `1`. |
| `INVITE_TTL_HOURS` | no | Default `48`. How long an account-invite link stays valid. New accounts are created without a password and set their own through this link. |
| `FRONTEND_URL` | no | Used in reset, invite and waitlist-claim links, and as the CORS fallback. |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | seed only | Read by `prisma/seed.ts`, never at runtime. |
| `SEED_DATA_PASSWORD` | seed only | Read by `prisma/seed-data.ts` (`npm run seed:data`), never at runtime. 12+ chars; refuses to run when `NODE_ENV=production`. |
| `SENTRY_DSN` | no | Empty = error tracking off. Production refuses to boot on a set-but-malformed value. See `DEPLOY.md` §4. |
| `TRUST_PROXY_HOPS` | behind a proxy | Number of reverse-proxy hops (`1` on Vercel or behind Caddy). Without it rate limiting counts every visitor as the proxy. |
| `PORT` | no | Default `4000`. |
| `NODE_ENV` | no | `development` locally. |

**With `NODE_ENV=production` the backend refuses to boot** when any of these hold — deliberately,
so a misconfigured deploy fails loudly instead of quietly:

- `JWT_ACCESS_SECRET` is unset, shorter than 32 characters, or starts with `REPLACE_`, `dev-` or
  `change-me`.
- `MAIL_TRANSPORT=smtp` without an `SMTP_HOST`.
- `MAIL_TRANSPORT=smtp` with a `MAIL_FROM` that is unset, a placeholder, or on a suffix that cannot
  receive a reply (`.local`, `.localhost`, `.invalid`, `.test`, `.example`) — otherwise the send
  succeeds, the mail vanishes, and the invited person never gets an account.
- `MAIL_TRANSPORT` is anything but `smtp`, unset included — a real deployment must send real mail.
- `SENTRY_DSN` is set but not a valid DSN, so a typo cannot ship as a deploy that looks healthy with
  error tracking silently off.

All of these except the transport check live in `configureApp()` (`backend/src/app-setup.ts`); the
transport check lives in `MailModule` (`backend/src/mail/mail.module.ts`), which defaults an unset
variable to `console`. One check is not production-only: a `TRUST_PROXY_HOPS` that is not a positive
integer fails the boot in **every** environment, on the same reasoning — throttling that looks
enabled and is not would be worse than a loud stop.

Frontend variables (`frontend/.env.local`):

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | no | Falls back to `http://localhost:4000`. Set it to an **empty string** when the frontend proxies `/api` itself — see `API_PROXY_TARGET`. |
| `API_PROXY_TARGET` | when hosted split | Backend origin that `frontend/next.config.mjs` rewrites `/api/*` to. This is what keeps the refresh cookie first-party on Vercel; without it users are signed out on every reload. `DEPLOY.md` §1.1. |
| `NEXT_PUBLIC_SENTRY_DSN` | no | Empty = frontend error tracking off. Baked in **at build time**, so it needs a rebuild, not a restart — and the Docker images take it as a build arg (`DOCKER.md`). |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | no | Appears in the compose files, `frontend/Dockerfile` and CI, but in no `.env*.example`, and is **read by nothing** — `lib/i18n.ts` hardcodes `bg` and lazy-loads `en`. |

## Everyday commands

Run from the repo root; each fans out over both workspaces.

```bash
npm run dev          # backend (watch) + frontend together
npm run build        # both
npm run test         # vitest in both — the backend suite hits a real SQLite file
npm run lint         # eslint; note the backend's runs with --fix and rewrites files
npm run typecheck    # tsc --noEmit in both
npm run seed         # backend: prisma db seed
```

More demo data on demand. This one has no root script — it takes arguments, so it is called on the
workspace directly:

```bash
npm run seed:data --workspace backend -- --help
npm run seed:data --workspace backend -- --create-tenant "Iron Gym" --size medium
npm run seed:data --workspace backend -- --fill iron-gym --size large
```

Needs `SEED_DATA_PASSWORD` (12+ characters) and refuses to run with `NODE_ENV=production`.

One workspace, or one test:

```bash
npm run dev  --workspace backend
npm run test --workspace frontend

npm --workspace backend  exec -- vitest run src/auth/auth.service.spec.ts
npm --workspace backend  exec -- vitest run -t "validateUser"
npm --workspace frontend exec -- vitest run __tests__/home.test.tsx
```

Prisma, from inside `backend/`:

```bash
npx prisma migrate dev --name <name>   # new migration in development
npx prisma migrate deploy              # apply existing migrations
npx prisma generate                    # regenerate the client after a schema change
npx prisma studio                      # browse the database
```

## Run it with Docker

```bash
cp .env.docker.example .env.docker   # then edit JWT_ACCESS_SECRET, SUPERADMIN_PASSWORD and SMTP_*
docker compose up --build            # development: hot reload, seeds on boot
```

`docker compose up` merges `docker-compose.override.yml`, which builds the `dev` stage of both
images, bind-mounts the repo for hot reload and sets `RUN_SEED=true`.

Production images instead:

```bash
docker compose -f docker-compose.yml up --build
```

- Frontend `http://localhost:3000`, backend `http://localhost:4000/api`, health check on
  `/api/health`.
- **The production images set `NODE_ENV=production`, so they need real SMTP details.** Fill in
  `SMTP_HOST` (and the user, password and `MAIL_FROM` your provider wants) before the first `up`, or
  the backend stops at boot. The development stack accepts `MAIL_TRANSPORT=console` instead.
- `RUN_MIGRATIONS` (default `true`) runs `prisma migrate deploy` at boot; `RUN_SEED` (default
  `false` in the entrypoint, `true` in `.env.docker.example`) runs the same seed described above,
  demo location and staff assignment included. A failing seed stops the container — which is what an
  unedited `SUPERADMIN_PASSWORD` causes.
- SQLite lives on the named volume `pulsedesk-db` mounted at `/data`, deliberately outside the bind
  mount so a rebuild cannot lose it.
- `docker compose down` stops everything; `docker compose down -v` also wipes the database volume.

`DOCKER.md` covers the rest.

## Platform maintenance

A **Maintenance** screen sits at the end of the sidebar for a `SUPER_ADMIN` only. It holds one
action: it deletes waiting-list entries for sessions that started more than 48 hours ago, and the
claim links that belong to them. Such an entry can never become a booking — the booking cutoff
already refuses it — and a customer stops seeing it the moment the session starts, so the sweep
removes dead rows rather than live queues. Attendance is untouched.

Nothing runs it on a schedule. The button is the manual door; the route behind it is
`POST /api/waitlists/sweep`, and a platform cron may call that instead — see `DEPLOY.md` §6. The
48-hour retention lives in `backend/src/waitlists/waitlists.service.ts`, not in an environment
variable.

## The API contract

`backend/openapi.json` and `frontend/lib/api-schema.d.ts` are **generated and committed**. Never
hand-edit them. After changing a route, a DTO or a `@ResponseSchema`, regenerate both and commit
the result:

```bash
npm run gen:api   --workspace backend    # nest build, then write backend/openapi.json (needs a migrated DB)
npm run gen:types --workspace frontend   # openapi-typescript, then write frontend/lib/api-schema.d.ts
```

CI runs the same two commands and fails if either file changes, so a stale artifact cannot merge.
Every route must carry a `@ResponseSchema`; `backend/src/generate-openapi.spec.ts` names any route
that does not.

### Looking at the API

Start the backend and open:

- `http://localhost:4000/api/docs` — Swagger UI, browsable and try-it-out enabled.
- `http://localhost:4000/api/docs-json` — the same document as raw JSON.

**Both are development only.** They are wired in `configureApp()` behind a `NODE_ENV !== 'production'`
check and return 404 in production. That gate is the entire control: Swagger registers its routes
directly on the HTTP adapter, so the global auth guards never run in front of it and anyone who can
reach the port can read it. Do not remove the check, and do not expose the port publicly in
development. The reasoning, with sources, is in `.workflow/research/RES-0002-client-docs-and-api-contract-exposure.md`.

For a spec you can read without booting anything, open the committed `backend/openapi.json`.

## Layout

```
backend/     NestJS 11 + Prisma 6 + SQLite. Global /api prefix, JWT auth, per-tenant roles.
frontend/    Next.js 16 App Router. (dashboard) for staff, (portal) for customers. bg + en.
docs/        Client-facing HTML user guides: four role guides, a getting-started page and five
             worked business setups, per language.
.workflow/   PRDs, epics, tickets, tech plans, research and the glossary.
.github/     CI: typecheck, lint, migrations, both test suites, generated-contract drift check,
             plus a non-blocking `npm audit`. `v*` tags also build and push both images to GHCR.
             Dependabot config, PR and issue templates live here too.
```

Conventions that matter before you change code: tests come first, every tenant-scoped table carries
`tenantId`, list endpoints return the shared pagination envelope, and dependency fixes go through the
root `overrides` block. `CLAUDE.md` has the full set.
