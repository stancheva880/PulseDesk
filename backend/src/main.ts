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

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
  Logger.log(`PulseDesk backend listening on http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
