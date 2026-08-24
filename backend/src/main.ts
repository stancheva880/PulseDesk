// Sentry must load before Nest — see instrument.ts. No-op when SENTRY_DSN is unset.
import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  configureApp(app, config);

  // Env values arrive as strings — get<number> would mistype it.
  const port = Number(config.get<string>('PORT')) || 4000;
  await app.listen(port);
  Logger.log(`PulseDesk backend listening on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
