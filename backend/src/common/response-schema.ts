import { SetMetadata } from '@nestjs/common';
import { z, type ZodType } from 'zod';

// One decorator call, two readers: ResponseSchemaInterceptor parses with the schema at
// runtime, and generate-openapi.ts converts the same object into the route's OpenAPI
// response schema. A route therefore cannot advertise a shape different from the one it is
// checked against.

export const RESPONSE_SCHEMA_KEY = 'pulsedesk:response-schema';

interface RegisteredSchema {
  name: string;
  schema: ZodType;
}

/**
 * Keyed by `<ControllerClass>_<method>`, which is the operationId @nestjs/swagger emits
 * (e.g. `ClassesController_findOne`). That is how generate-openapi.ts matches an operation
 * in the document back to its schema.
 */
export const responseSchemas = new Map<string, RegisteredSchema>();

/** For 204 handlers: parsed at runtime, but deliberately absent from the document. */
export const NoContent = z.void();

export function ResponseSchema(name: string, schema: ZodType): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    responseSchemas.set(`${target.constructor.name}_${String(propertyKey)}`, { name, schema });
    return SetMetadata(RESPONSE_SCHEMA_KEY, schema)(target, propertyKey, descriptor);
  };
}

// === Wire helpers ===
// Values reaching the interceptor are runtime objects, so schemas describe those and
// transform to the wire shape. z.toJSONSchema with io: 'output' then describes the result.

/** Prisma `Decimal` (or any numeric) as the string it serializes to. */
export const decimalString = z
  .unknown()
  .transform((value) => String(value))
  .pipe(z.string());

export const nullableDecimalString = z.union([z.null(), decimalString]);

/** A `DateTime` column as its ISO string. */
export const isoDate = z
  .date()
  .transform((value) => value.toISOString())
  .pipe(z.string());

/** An optional `DateTime` column — its ISO string, or null. */
export const nullableIsoDate = z.union([z.null(), isoDate]);

/** The envelope every top-level list route returns — mirrors buildPaginatedResult. */
export function paginatedSchema<T extends ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  });
}

/**
 * The JSON Schema for a route's response, or null when the route has no body.
 * `io: 'output'` is required — with the default ('input') a transformed field converts to
 * `{}` instead of its wire type.
 */
export function toResponseJsonSchema(schema: ZodType): Record<string, unknown> | null {
  if (schema === NoContent) return null;
  const { $schema: _drop, ...jsonSchema } = z.toJSONSchema(schema, { io: 'output' });
  return jsonSchema;
}
