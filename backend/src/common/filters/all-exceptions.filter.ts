import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface SanitizedErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  path: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error } = this.classify(exception);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${request.method} ${request.url} -> ${statusCode}: ${message}`, stack);
    }

    const body: SanitizedErrorResponse = {
      statusCode,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private classify(exception: unknown): { statusCode: number; message: string; error: string } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const res = exception.getResponse();
      const error = exception.name.replace(/Exception$/, '');
      const message = this.extractMessage(res) ?? exception.message;
      return { statusCode, message, error };
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
}
