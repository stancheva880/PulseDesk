import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { AuthModule } from '@/auth/auth.module';
import { MailModule } from '@/mail/mail.module';
import { AuthService } from '@/auth/auth.service';
import { LocationScopeModule } from '@/auth/scope/location-scope.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { TenantsModule } from './tenants.module';

const PASSWORD = 'TestPass123!';

describe('TenantsController (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const userIds: string[] = [];
  const tenantIds: string[] = [];
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PrismaModule,
        LocationScopeModule,
        AuthModule,
        MailModule,
        TenantsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = moduleRef.get(PrismaService);
    auth = moduleRef.get(AuthService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (tenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    await app.close();
  });

  async function newSuperAdmin(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@super.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role: UserRole.SUPER_ADMIN,
        tenantId: null,
      },
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);
    return tokens.accessToken;
  }

  async function newTenantUser(role: UserRole) {
    const tenant = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'Test Tenant' },
    });
    tenantIds.push(tenant.id);
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@x.local`,
        passwordHash: await auth.hashPassword(PASSWORD),
        role,
        tenantId: tenant.id,
      },
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);
    return tokens.accessToken;
  }

  it('SUPER_ADMIN can list tenants', async () => {
    const t = await prisma.tenant.create({
      data: { slug: `t-${randomUUID()}`, name: 'Visible Tenant' },
    });
    tenantIds.push(t.id);
    const token = await newSuperAdmin();
    const res = await request(server)
      .get('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.find((x: { id: string }) => x.id === t.id)).toBeDefined();
  });

  it('ADMIN gets 403', async () => {
    const token = await newTenantUser(UserRole.ADMIN);
    await request(server)
      .get('/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('returns 401 without auth', async () => {
    await request(server).get('/tenants').expect(401);
  });
});
