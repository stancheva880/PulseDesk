import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import type { ZodType } from 'zod';
import { RESPONSE_SCHEMA_KEY } from './response-schema';

@Injectable()
export class ResponseSchemaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseSchemaInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<ZodType | undefined>(
      RESPONSE_SCHEMA_KEY,
      context.getHandler(),
    );
    if (!schema) return next.handle();
    return next.handle().pipe(map((value) => this.enforce(schema, value, context)));
  }

  // Fail hard outside production; degrade inside it. The enforcement value is in CI and the
  // test suite — a schema typo must not 500 a live endpoint for a real club.
  private enforce(schema: ZodType, value: unknown, context: ExecutionContext): unknown {
    const result = schema.safeParse(value);
    if (result.success) return result.data;

    const request = context.switchToHttp().getRequest<{ method?: string; url?: string }>();
    // Paths only, never issues[].received — that would write trainee data or a token to a log.
    const paths = result.error.issues
      .map((issue) => issue.path.join('.') || '(root)')
      .join(', ');
    const summary = `Response schema mismatch on ${request?.method ?? '?'} ${
      request?.url ?? '?'
    }: ${paths}`;

    if ((this.config.get<string>('NODE_ENV') ?? '').toLowerCase() === 'production') {
      this.logger.error(summary);
      return value;
    }
    throw new Error(summary);
  }
}
