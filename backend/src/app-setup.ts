import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const PLACEHOLDER_SECRET_PATTERNS = [/^REPLACE_/i, /^dev-/i, /^change-me/i];

function looksLikePlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return PLACEHOLDER_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function assertProductionSecrets(config: ConfigService): void {
  const env = (config.get<string>('NODE_ENV') ?? '').toLowerCase();
  if (env !== 'production') return;
  const accessSecret = config.get<string>('JWT_ACCESS_SECRET');
  if (looksLikePlaceholder(accessSecret)) {
    throw new Error(
      'JWT_ACCESS_SECRET is unset or still a placeholder; refusing to boot in production.',
    );
  }
}

export function configureApp(app: INestApplication, config: ConfigService): void {
  assertProductionSecrets(config);
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
}
