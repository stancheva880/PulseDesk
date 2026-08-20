import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { looksLikePlaceholder } from './common/credential-guards';
import { buildOpenApiDocument } from './common/openapi-document';

// `openssl rand -base64 32` (what .env.example prescribes) yields 44 chars; 32 is
// the floor for a 256-bit HMAC key. RFC 8725 3.5 — sufficient key entropy.
const MIN_SECRET_LENGTH = 32;

// Reserved suffixes from RFC 2606 / 6761 / 6762. Mail sent from one of these can never be
// replied to and most receivers drop it, so smtp-mail.service.ts's noreply@pulsedesk.local
// fallback is exactly the value production must never ship. Matches both `user@host` and the
// `Display Name <user@host>` form.
const UNROUTABLE_MAIL_DOMAIN = /.(local|localhost|invalid|test|example)>?s*$/i;

export function assertProductionSecrets(config: ConfigService): void {
  const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
  if (env !== 'production') return;
  const accessSecret = config.get<string>('JWT_ACCESS_SECRET');
  if (looksLikePlaceholder(accessSecret)) {
    throw new Error(
      'JWT_ACCESS_SECRET is unset or still a placeholder; refusing to boot in production.',
    );
  }
  // Never echo the value — this message reaches logs.
  if (accessSecret!.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT_ACCESS_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; refusing to boot in production.`,
    );
  }
  // SmtpMailService only builds its transporter on the first send, so without this
  // the deploy looks healthy and fails at the first password reset instead.
  const mailTransport = (config.get<string>('MAIL_TRANSPORT') ?? '').toLowerCase();
  if (mailTransport === 'smtp') {
    if (!config.get<string>('SMTP_HOST')) {
      throw new Error(
        'MAIL_TRANSPORT=smtp but SMTP_HOST is unset; refusing to boot in production.',
      );
    }
    // Same failure shape, one step further along: the send itself succeeds and the mail is
    // rejected or spam-filed by the receiver, so nothing surfaces at all. Since EPIC-0009 the
    // invite mail is the only route to an account, which makes an undeliverable from-address
    // a lockout. MAIL_FROM is on every outgoing mail, so echoing it here leaks nothing.
    const mailFrom = config.get<string>('MAIL_FROM') ?? '';
    if (looksLikePlaceholder(mailFrom) || UNROUTABLE_MAIL_DOMAIN.test(mailFrom)) {
      throw new Error(
        `MAIL_TRANSPORT=smtp but MAIL_FROM is unset, a placeholder, or on a reserved domain that cannot deliver ("${mailFrom}"); refusing to boot in production.`,
      );
    }
  }
}

export function configureApp(app: INestApplication, config: ConfigService): void {
  assertProductionSecrets(config);
  applyTrustProxy(app, config);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const frontendUrl = config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
  const raw = config.get<string>('CORS_ALLOWED_ORIGINS');
  const allowedOrigins = raw
    ? raw.split(',').map((o) => o.trim()).filter(Boolean)
    : [frontendUrl];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Tenant-Id'],
  });

  mountApiReference(app, config);
}

/**
 * Serves Swagger UI at /api/docs (raw document at /api/docs-json) — outside production only.
 *
 * The gate is the whole control: Swagger registers on the express adapter, not as a Nest route,
 * so JwtAuthGuard, RolesGuard and ThrottlerGuard never run in front of it and the page is
 * readable by anyone who can reach the port. RES-0002 has the reasoning.
 *
 * Request bodies are described by the @nestjs/swagger tsc transformer, so they are complete under
 * `nest start`/`nest build` and thin under Vitest's swc — expected, and why the committed
 * backend/openapi.json (built by `gen:api` after `nest build`) stays the artifact of record.
 */
function mountApiReference(app: INestApplication, config: ConfigService): void {
  if ((config.get<string>('NODE_ENV') ?? '').toLowerCase() === 'production') return;

  const { document } = buildOpenApiDocument(app);
  // SwaggerModule reaches for useStaticAssets, which lives on the express application only.
  SwaggerModule.setup('docs', app as NestExpressApplication, document, { useGlobalPrefix: true });
}

/**
 * Opts into X-Forwarded-For, when a proxy is actually in front of the app.
 *
 * Express ignores the header until `trust proxy` is set, so behind a TLS-terminating proxy
 * ThrottlerGuard's default tracker sees the proxy's address on every request and buckets the
 * whole internet together — the 3/min forgot-password limit becomes a global 3/min, and no
 * single attacker is limited at all.
 *
 * The value must be a hop count. `trust proxy: true` trusts the leftmost header entry, which a
 * client controls, so it would let an attacker mint a fresh bucket per request and remove
 * throttling entirely. Unset keeps express's default (`false`), so a deployment that answers on
 * its own port is unaffected — and a typo is a failed boot rather than throttling that looks
 * enabled and is not.
 */
function applyTrustProxy(app: INestApplication, config: ConfigService): void {
  const raw = config.get<string>('TRUST_PROXY_HOPS');
  if (!raw) return;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 1) {
    throw new Error(
      `TRUST_PROXY_HOPS must be a positive integer (the number of proxies in front of this app); got "${raw}".`,
    );
  }
  (app as NestExpressApplication).set('trust proxy', hops);
}
