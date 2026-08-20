# Deploy PulseDesk

This document tells you how to put PulseDesk on the internet, how to set up mail,
and how to get a domain with HTTPS.

There are two deployment paths:

| Path | Use it when | TLS |
|---|---|---|
| **Vercel + Turso** | You want the shortest path. No server to maintain. | Automatic |
| **Docker on your own server** | You must keep the data on your own hardware. | You set it up — see Appendix A |

This document covers Vercel + Turso first, because the repository already
contains the code for it. For the Docker path, read `DOCKER.md` first, then
Appendix A of this document.

---

## 1. Deploy to Vercel + Turso

### 1.1 Why two Vercel projects

The backend and the frontend deploy as **two separate Vercel projects** from the
same repository. The backend runs as one serverless function
(`backend/api/[[...path]].ts`); the frontend runs as a normal Next.js app.

The frontend then proxies `/api/*` to the backend. Do not remove this proxy. The
refresh-token cookie is `httpOnly` and `sameSite=strict` on path `/api/auth`
(`backend/src/auth/cookies.ts`). A `sameSite=strict` cookie is sent only when the
two hosts share a registrable domain. `vercel.app` is a public suffix, so
`app-frontend.vercel.app` and `app-backend.vercel.app` are different sites, and
the browser never sends the cookie. The proxy makes every request same-origin.
Without it, users are logged out on each page reload.

### 1.2 Create the database

Turso hosts SQLite over HTTP. The schema does not change: the Prisma provider
stays `sqlite`, and the same committed migrations apply.

```bash
turso db create pulsedesk
turso db show pulsedesk --url          # libsql://pulsedesk-<org>.turso.io
turso db tokens create pulsedesk       # the auth token
```

Keep both values. The backend needs them together. If you set
`TURSO_DATABASE_URL` and forget `TURSO_AUTH_TOKEN`, the app refuses to start
(`backend/src/prisma/prisma-options.ts`).

### 1.3 Apply the migrations

`prisma migrate deploy` cannot connect to Turso. Use the replacement script:

```bash
cd backend
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." node scripts/turso-migrate.mjs
```

PowerShell:

```powershell
cd backend
$env:TURSO_DATABASE_URL="libsql://..."
$env:TURSO_AUTH_TOKEN="..."
node scripts/turso-migrate.mjs
```

The script records applied migrations in a `_turso_migrations` table. It is
idempotent. Run it again after every deploy that adds a migration.

### 1.4 Create the first account

The migrations create empty tables. Nobody can log in yet. Run the seed against
the same database to create the super admin:

```bash
cd backend
TURSO_DATABASE_URL="libsql://..." TURSO_AUTH_TOKEN="..." \
SUPERADMIN_EMAIL="you@example.com" SUPERADMIN_PASSWORD="<12+ characters>" \
npm run seed
```

The seed reads the same `TURSO_*` variables as the app, so it writes to the
hosted database. It is idempotent. It also creates a demo club. To skip the demo
data, set `NODE_ENV=production` in the same command.

### 1.5 Backend project settings

In the Vercel dashboard, create a project from this repository.

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm run vercel-build` (this is `prisma generate && nest build`) |
| Install Command | leave the default |

Environment variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `TURSO_DATABASE_URL` | `libsql://...` |
| `TURSO_AUTH_TOKEN` | the token from step 1.2 |
| `JWT_ACCESS_SECRET` | 32 characters minimum. Generate with `openssl rand -base64 32` |
| `JWT_ACCESS_TTL` | `15m` |
| `JWT_REFRESH_TTL` | `7d` |
| `FRONTEND_URL` | the public frontend URL, for example `https://pulsedesk.example.com` |
| `CORS_ALLOWED_ORIGINS` | the same public frontend URL |
| `MAIL_TRANSPORT` | `smtp` — see section 3 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | see section 3 |
| `MAIL_FROM` | `PulseDesk <noreply@example.com>` — a real domain, see section 3 |
| `PASSWORD_RESET_TTL_HOURS` | `1` |
| `INVITE_TTL_HOURS` | `48` |
| `TRUST_PROXY_HOPS` | `1` |

Do not set `DATABASE_URL`. `TURSO_DATABASE_URL` replaces it.

The backend refuses to start in production if `JWT_ACCESS_SECRET` is a
placeholder or shorter than 32 characters, or if `MAIL_TRANSPORT=smtp` and
`SMTP_HOST` or `MAIL_FROM` is missing or unusable (`backend/src/app-setup.ts`).
This is deliberate: a broken mail configuration would otherwise look healthy
until the first invite fails.

Swagger UI at `/api/docs` is disabled when `NODE_ENV=production`. Do not remove
that check. Swagger registers directly on the HTTP adapter, so the
authentication guards never run in front of it.

### 1.6 Frontend project settings

Create a second Vercel project from the same repository.

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Build Command | the default (`next build`) |

Environment variables:

| Variable | Value | Why |
|---|---|---|
| `API_PROXY_TARGET` | the backend project URL, for example `https://pulsedesk-backend.vercel.app` | Makes `/api/*` same-origin. See section 1.1. |
| `NEXT_PUBLIC_API_URL` | **an empty string** | Makes the browser call the relative path `/api`. |

`NEXT_PUBLIC_API_URL` must be an empty string, not unset. If it is unset, the
frontend calls `http://localhost:4000/api` and every request fails.

### 1.7 Verify the deployment

1. Open `https://<backend>/api/health`. The response must be a health payload.
2. Open `https://<frontend>/api/health`. The response must be the same payload.
   If it is not, the proxy is wrong.
3. Log in with the super-admin account from step 1.4.
4. Reload the page. If you stay logged in, the refresh cookie works. If you are
   sent back to the login page, read section 1.1 again.

---

## 2. Domain and HTTPS

### 2.1 On Vercel there is no certificate work

Vercel issues and renews the TLS certificate for you. This applies to the
`*.vercel.app` address and to any custom domain you attach. There is no Let's
Encrypt step, no `certbot`, and no renewal cron job. Attach the domain in the
project settings, add the DNS records Vercel shows you, and wait for the
certificate. It renews on its own.

### 2.2 About "free" domains

There is no good free domain any more. Freenom stopped issuing `.tk`, `.ml`,
`.ga`, `.cf` and `.gq` domains, so that route is closed.

What is still free:

- **DuckDNS**, `yourname.duckdns.org` — free, works with Let's Encrypt.
- **nip.io / sslip.io** — a hostname that resolves to an IP address you supply.

Both have the same limitation: **you cannot send mail from them.** You do not
control the DNS zone, so you cannot publish the SPF and DKIM records that
section 3 needs. PulseDesk sends invite mail, and an invite is the only way to
create an account. Mail that goes to spam is a lockout.

**Recommendation: buy a domain.** A `.eu`, `.com` or `.bg` domain costs about
6-12 EUR per year. Use any registrar. You then control DNS, so the domain works
for the site and for mail.

### 2.3 Point the domain at Vercel

1. In the frontend Vercel project, open Settings, then Domains, and add your
   domain.
2. Vercel shows an `A` record or a `CNAME` record. Add it at your registrar.
3. Wait. Vercel issues the certificate when the DNS resolves.

Leave the backend project on its `*.vercel.app` address. Only the frontend needs
the public domain, because all API traffic goes through the proxy.

---

## 3. Mail

PulseDesk sends three kinds of mail: the password-reset link, the account invite
link, and a "you were added to a club" notice. Only the first two contain a
link. The invite is the only way to create an account, so mail must work before
you add users.

### 3.1 Your own SMTP credentials

Yes, credentials from your own mail server work. Set these variables:

```
MAIL_TRANSPORT=smtp
SMTP_HOST=mail.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=<the password>
MAIL_FROM="PulseDesk <noreply@example.com>"
```

**Important — the port decides the encryption.** There is no `SMTP_SECURE`
variable. The code turns on implicit TLS only when the port is `465`
(`backend/src/mail/smtp-mail.service.ts`):

- Port `465` — implicit TLS. The connection is encrypted from the start.
- Port `587` — STARTTLS. Nodemailer upgrades the connection.
- Any other port — no implicit TLS.

Use `465` or `587`. Do not use port `25`.

If `SMTP_USER` and `SMTP_PASS` are both empty, the code connects without
authentication. Most servers reject that.

### 3.2 Free third-party providers

These are safe to use. All of them encrypt in transit, and all of them handle
DKIM signing for you. DKIM is the part that decides whether your mail arrives.

| Provider | Free tier | Notes |
|---|---|---|
| **Brevo** | 300 mail per day | Good free limit. SMTP and API. |
| **Mailjet** | 200 per day, 6000 per month | SMTP and API. EU company. |
| **Resend** | 3000 per month, 100 per day | Simple setup. SMTP available. |
| **Amazon SES** | Not free, about 0.10 USD per 1000 | Cheapest at volume. More setup. |

Each of them gives you a host, a port, a user and a password. Put those in the
four `SMTP_*` variables. Nothing in the code changes.

**Gmail** also works with an app password, but Google limits it to about 500 mail
per day and treats bulk transactional mail as abuse. Use it only for a test.

Check the current free limits before you choose. Providers change them.

### 3.3 DNS records for delivery

Add these records to the domain in `MAIL_FROM`, or your mail goes to spam:

- **SPF** — a `TXT` record that lists who may send for the domain. Your provider
  gives you the exact value.
- **DKIM** — a `TXT` record with a public key. Your provider gives you the value.
- **DMARC** — a `TXT` record at `_dmarc.example.com`. Start with
  `v=DMARC1; p=none; rua=mailto:you@example.com` and make it stricter later.

### 3.4 MAIL_FROM must be a real domain

Production refuses to start if `MAIL_FROM` is a placeholder or ends in `.local`,
`.localhost`, `.invalid`, `.test` or `.example` (`backend/src/app-setup.ts`).
These domains cannot receive a reply, and receivers drop mail from them. The
check exists because the failure is otherwise silent: the send succeeds, the
mail disappears, and the invited person never gets an account.

### 3.5 Test mail without a server

In development, set `MAIL_TRANSPORT=console`. The full message, including the
invite link, is written to the backend log. Production rejects this setting.

---

## 4. What happens when a class price changes

This is a common question, so the behaviour is written down here.

**Old fees do not change. Analytics stay correct.**

When you generate fees, PulseDesk copies the price from the class into each fee
row (`Fee.amount`). The fee keeps that number. It is a snapshot, not a
reference.

Example. "Adult Conditioning" costs 15 EUR per session. You raise it to 20 EUR
next month.

- Fees already generated at 15 EUR stay at 15 EUR.
- Fees you generate after the change are 20 EUR.
- The dashboard adds up `Fee.amount` and `Payment.amount`. It never reads the
  class price. Past months keep showing 15 EUR, and future months show 20 EUR.
  The chart is a true record of what you charged.

Two things to know:

1. **Fees generated in advance keep the old price.** If you generated September
   fees in August and then raised the price, the September fees are still at the
   old price. Delete them and generate again, or edit each fee amount.
2. **There is no price history.** The class stores one current price. To find
   what a class cost in March, look at a fee from March. Nothing else records it.

---

## Appendix A — HTTPS when you host it yourself

Read `DOCKER.md` first. It describes the production stack. That stack publishes
plain HTTP on ports 3000 and 4000. Add a reverse proxy in front of it for TLS.

Use **Caddy**. It requests and renews Let's Encrypt certificates on its own.
There is no `certbot`, and no renewal timer to configure.

`Caddyfile`:

```
pulsedesk.example.com {
	reverse_proxy frontend:3000
}
```

Add the service to `docker-compose.yml`:

```yaml
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on:
      - frontend
```

Add `caddy-data:` to the `volumes:` block. The certificates live there. If you
lose that volume, Caddy requests new certificates, and Let's Encrypt rate limits
apply.

Then:

1. Point the domain `A` record at the server.
2. Open ports 80 and 443. Port 80 is required for the ACME challenge.
3. Remove the `ports:` mapping from the `frontend` service, so only Caddy is
   reachable from outside.
4. Set `TRUST_PROXY_HOPS=1` in `.env.docker`. Without it, rate limiting counts
   every visitor as the proxy and stops working.

The backend keeps its own port for the frontend to reach. Do not publish it.

---

## Appendix B — these documents are not tracked by git

`.gitignore` ends with:

```
*.md
!README.md
```

Every markdown file except `README.md` is ignored. That includes `DEPLOY.md`,
`DOCKER.md`, `PRD.md`, `CLAUDE.md` and `AUDIT.md`. They exist on disk and
disappear on a fresh clone.

To keep this document, add the exceptions:

```
*.md
!README.md
!DEPLOY.md
!DOCKER.md
!PRD.md
!CLAUDE.md
```

This is your decision, not an automatic one. Make it before you commit.
