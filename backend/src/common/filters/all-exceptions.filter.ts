import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';

// What a throw site adds when the message is one a user can act on, so the client can
// show it in the user's language: `throw new BadRequestException({ message, code, params })`.
// `error` cannot serve for this — it is the Nest class name, so every Conflict in the app
// collapses to the same value. `message` stays English and is the client's fallback for a
// code its bundle has no key for, which is what lets codes be added a few at a time.
interface CodedResponse {
  code?: string;
  params?: Record<string, string | number>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error, code, params } = this.classify(exception);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${request.method} ${request.url} -> ${statusCode}: ${message}`, stack);
      // getClient() is undefined unless instrument.ts initialized the SDK (SENTRY_DSN set),
      // so the DSN-less path costs nothing. The flush must complete BEFORE the response:
      // Vercel freezes the function when the response ends, and a buffered event would be
      // lost (TKT-0097). Worst case this holds a 5xx response for 2s; 4xx and the happy
      // path never enter this branch. A flush failure must never break the response.
      if (Sentry.getClient()) {
        Sentry.captureException(exception, {
          contexts: { request: { method: request.method, url: request.url } },
        });
        await Sentry.flush(2000).catch(() => undefined);
      }
    }

    const body = {
      statusCode,
      message,
      error,
      ...(code ? { code } : {}),
      ...(params ? { params } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private classify(exception: unknown): {
    statusCode: number;
    message: string;
    error: string;
  } & CodedResponse {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      const error = exception.name.replace(/Exception$/, '');
      const message = this.extractMessage(res) ?? exception.message;
      return { statusCode, message, error, ...this.extractCode(res) };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'InternalServerError',
    };
  }

  private extractMessage(res: unknown): string | undefined {
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object' && 'message' in res) {
      const value = (res as { message: unknown }).message;
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value.join('; ');
    }
    return undefined;
  }

  private extractCode(res: unknown): CodedResponse {
    if (!res || typeof res !== 'object') return {};
    const { code, params } = res as CodedResponse;
    return {
      ...(typeof code === 'string' ? { code } : {}),
      ...(params && typeof params === 'object' ? { params } : {}),
    };
  }
}
