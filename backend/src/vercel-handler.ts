/**
 * Serverless entry point (Vercel) — the actual Nest bootstrap.
 *
 * Lives in `src/`, not `api/`, so it compiles through the normal `nest build` (see
 * `nest-cli.json`): NestJS CLI's `tsc` builder rewrites the `@/*` path alias (`tsconfig.json`) to
 * relative `require()`s in `dist/`, but Vercel's own Node.js function bundler does not resolve
 * `@/` aliases at all (https://github.com/vercel/vercel/discussions/10717). The whole `AppModule`
 * graph uses `@/` throughout, so importing this file's TypeScript source directly from `api/`
 * crashed every request with "Cannot find module '@/auth/decorators/current-user.decorator'" (or
 * whichever file Vercel's bundler happened to hit first). `api/[[...path]].ts` is a thin
 * `require()` shim that loads this file's compiled, alias-free `dist/` output instead.
 *
 * The counterpart of `src/main.ts`: same app, same `configureApp()`, no `listen()`. A serverless
 * host owns the socket and hands over one request at a time, so the Express instance is built once
 * per container and cached — a warm invocation skips the whole Nest bootstrap, which is the
 * difference between a fast response and a cold start on every request.
 *
 * `configureApp()` is deliberately shared with `src/main.ts` rather than reimplemented here. It
 * carries helmet, the global `api` prefix, the whitelisting ValidationPipe, the exception filter,
 * the CORS allowlist and the production secret guard; a second copy would drift and the deployed
 * app would quietly lose one of them.
 */
// Sentry must load before Nest — see src/instrument.ts. No-op when SENTRY_DSN is unset.
import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import express, { type Express, type Request, type Response } from 'express';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';

let cached: Promise<Express> | undefined;

async function build(): Promise<Express> {
  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  configureApp(app, app.get(ConfigService));
  // init(), not listen() — the platform is already listening.
  await app.init();
  return server;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  // Assigned before it resolves, so two concurrent cold requests share one bootstrap.
  cached ??= build();
  (await cached)(req, res);
}
