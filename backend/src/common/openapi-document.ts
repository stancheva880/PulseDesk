import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { responseSchemas, toResponseJsonSchema } from './response-schema';

// The single place the OpenAPI document is built. Both readers call it:
//   - app-setup.ts, for the Swagger UI served at /api/docs outside production
//   - generate-openapi.ts, for the committed backend/openapi.json
// They used to build one each, which is how the served document ended up without any
// response schemas at all while the committed file had them.

// Kept in step with backend/package.json by hand — a JSON import would need
// resolveJsonModule, and this is the only consumer.
const API_VERSION = '0.1.0';

const TENANT_HEADER = 'X-Tenant-Id';

const DESCRIPTION = [
  'Multi-tenant API for trainers, clubs and schools: trainees, classes, weekly schedules,',
  'sessions, attendance and fees.',
  '',
  '**Authentication.** Every route is guarded by default. Send the access token as',
  '`Authorization: Bearer <token>`; obtain one from `POST /api/auth/login`. The routes under',
  '`/api/health` and the login, refresh, logout and password-reset routes under `/api/auth` are the',
  'only public ones; `GET /api/auth/memberships` needs a token like every other route. The access',
  'token is short-lived — `POST /api/auth/refresh` rotates it using the opaque refresh token. A',
  'browser sends that token as an httpOnly cookie; any other client may send it in the request body',
  'instead, and then the rotated pair comes back in the response body.',
  '',
  `**Tenancy.** A caller selects the tenant to act in with the \`${TENANT_HEADER}\` header. For a`,
  'tenant-bound user it must name a tenant they hold a membership in — 403 otherwise — and the',
  "request's effective role becomes that membership's role. For a `SUPER_ADMIN`, who holds no",
  'membership, it must name an existing active tenant — 404 otherwise. Omit the header and the',
  "token's own `role` and `tenantId` claims stand.",
  '',
  '**Pagination.** Top-level list routes accept `page`/`pageSize` (default 25, max 100) and',
  'return `{ items, page, pageSize, total, totalPages }`. Parent-scoped sub-lists — a trainee\'s',
  'contacts, a fee\'s payments, a session\'s attendances, the `me/*` routes — return plain arrays.',
].join('\n');

// Tag names are the ones @nestjs/swagger derives from the controller class names; declaring
// them here only attaches a description, so no controller needs an @ApiTags decorator.
const TAGS: ReadonlyArray<readonly [string, string]> = [
  ['Auth', 'Login, token refresh, logout and the password-reset flow. Public.'],
  ['Memberships', "The signed-in user's tenant memberships, for the tenant picker."],
  ['Tenants', 'Clubs and schools. SUPER_ADMIN only, reads included.'],
  ['Users', 'Staff and customer accounts, their roles and location assignments.'],
  ['Locations', 'Venues within a tenant. Writes are SUPER_ADMIN only.'],
  ['Classes', 'Training groups, their billing mode and their trainer/trainee rosters.'],
  ['Trainees', 'Trainee records. Creating a trainee under 18 requires at least one contact.'],
  ['Contacts', 'Guardian contacts belonging to one trainee.'],
  ['ClassSchedules', 'Recurring weekly slots, and the flow that materialises sessions from them.'],
  ['Sessions', 'Concrete dated sessions and their per-session trainer roster.'],
  ['Attendances', "Attendance marking, bulk updates, the customer RSVP route and the customer's own session list."],
  ['Fees', 'Charges raised against a trainee, including the bulk generators.'],
  ['CustomerFees', "A customer's own fees, for the portal."],
  ['Payments', 'The manual payment ledger recorded against a fee.'],
  ['Dashboard', 'Aggregated fee and cash-flow figures for the charts.'],
  ['Health', 'Liveness probe. Public.'],
];

/**
 * Points every @ResponseSchema-decorated operation at a named component built from the same
 * zod object the interceptor parses with. Handlers registered as NoContent (204) convert to
 * null and keep the plugin's body-less response.
 *
 * Operations are matched by operationId, which @nestjs/swagger emits as
 * `<ControllerClass>_<method>` — exactly the key the decorator registers under.
 */
export function attachResponseSchemas(document: OpenAPIObject): string[] {
  document.components ??= {};
  document.components.schemas ??= {};
  const schemas = document.components.schemas;
  const attached: string[] = [];

  for (const pathItem of Object.values(document.paths)) {
    for (const operation of Object.values(pathItem) as OperationLike[]) {
      const registered = operation?.operationId
        ? responseSchemas.get(operation.operationId)
        : undefined;
      if (!registered) continue;

      const jsonSchema = toResponseJsonSchema(registered.schema);
      if (!jsonSchema) continue;

      schemas[registered.name] = jsonSchema;
      const success = Object.entries(operation.responses ?? {}).find(([code]) =>
        code.startsWith('2'),
      )?.[1];
      if (success) {
        success.content = {
          'application/json': { schema: { $ref: `#/components/schemas/${registered.name}` } },
        };
      }
      attached.push(registered.name);
    }
  }
  return attached;
}

interface OperationLike {
  operationId?: string;
  responses?: Record<string, { content?: unknown } | undefined>;
}

/**
 * Builds the document and attaches the response schemas. Returns both, because the generator
 * reports which schemas it wrote and the UI does not care.
 */
export function buildOpenApiDocument(app: INestApplication): {
  document: OpenAPIObject;
  attached: string[];
} {
  const builder = new DocumentBuilder()
    .setTitle('PulseDesk API')
    .setDescription(DESCRIPTION)
    .setVersion(API_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    // Applies to the public auth/health routes too, which is noise rather than a lie: they
    // ignore the header. The alternative is an @ApiHeader on all fourteen guarded controllers.
    .addGlobalParameters({
      name: TENANT_HEADER,
      in: 'header',
      required: false,
      description:
        'Tenant the caller acts in. A tenant-bound user must name one of their own tenants ' +
        '(403 otherwise); a SUPER_ADMIN may name any active tenant (404 otherwise).',
      schema: { type: 'string' },
    });
  for (const [name, description] of TAGS) builder.addTag(name, description);

  const document = SwaggerModule.createDocument(app, builder.build());
  const attached = attachResponseSchemas(document);
  return { document, attached };
}
