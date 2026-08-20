/**
 * Serverless entry point (Vercel).
 *
 * The counterpart of `src/main.ts`: same app, same `configureApp()`, no `listen()`. A serverless
 * host owns the socket and hands over one request at a time, so the Express instance is built once
 * per container and cached — a warm invocation skips the whole Nest bootstrap, which is the
 * difference between a fast response and a cold start on every request.
 *
 * The filename is an optional catch-all on purpose. Every route this app serves lives under the
 * global `api` prefix, so `api/[[...path]].ts` collects all of them through Vercel's own filesystem
 * routing and the request arrives with its original URL. A single-file `api/index.ts` plus a
 * `"rewrites"` entry in vercel.json would hand Nest the rewritten path instead — `/api` for every
 * request — and every route would 404.
 *
 * `configureApp()` is deliberately shared with `src/main.ts` rather than reimplemented here. It
 * carries helmet, the global `api` prefix, the whitelisting ValidationPipe, the exception filter,
 * the CORS allowlist and the production secret guard; a second copy would drift and the deployed
 * app would quietly lose one of them.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import express, { type Express, type Request, type Response } from 'express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';

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
