import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { MailModule } from '@/mail/mail.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { ResponseSchemaInterceptor } from '@/common/response-schema.interceptor';
import { createTestUser } from '@/test-utils/create-user';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';

const PASSWORD = 'TestPass123!';

describe('GET /auth/memberships (e2e-ish)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  const userIds: string[] = [];
  const tenantIds: string[] = [];
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, MailModule, AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // AppModule registers this as an APP_INTERCEPTOR; this spec builds its own module graph,
    // so it wires the interceptor here too — without it these routes would be unenforced.
    app.useGlobalInterceptors(
      new ResponseSchemaInterceptor(app.get(Reflector), app.get(ConfigService)),
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

  async function newTenant(name: string) {
    const tenant = await prisma.tenant.create({ data: { name, slug: `t-${randomUUID()}` } });
    tenantIds.push(tenant.id);
    return tenant;
  }

  it("returns the caller's memberships, oldest first, with tenant names", async () => {
    const a = await newTenant('Club A');
    const b = await newTenant('Club B');
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@m.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.ADMIN,
      tenantId: a.id,
    });
    userIds.push(user.id);
    await prisma.membership.create({
      data: {
        userId: user.id,
        tenantId: b.id,
        role: UserRole.EMPLOYEE,
        createdAt: new Date(Date.now() + 60_000),
      },
    });
    const tokens = await auth.login(user);

    const res = await request(server)
      .get('/auth/memberships')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect(res.body).toEqual([
      { tenantId: a.id, tenantName: 'Club A', role: UserRole.ADMIN },
      { tenantId: b.id, tenantName: 'Club B', role: UserRole.EMPLOYEE },
    ]);
  });

  it('returns [] for SUPER_ADMIN', async () => {
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@super.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.SUPER_ADMIN,
    });
    userIds.push(user.id);
    const tokens = await auth.login(user);

    const res = await request(server)
      .get('/auth/memberships')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect(res.body).toEqual([]);
  });

  it('returns 401 without a token', async () => {
    await request(server).get('/auth/memberships').expect(401);
  });

  // The removed-mid-use scenario: the client calls WITHOUT X-Tenant-Id (the stored
  // context may point at the tenant the user was just removed from — with the header
  // attached, TenantContextGuard would 403 before the handler).
  it('works without X-Tenant-Id: a member removed from their active tenant still gets the remaining list', async () => {
    const a = await newTenant('Keep Club');
    const b = await newTenant('Removed Club');
    const user = await createTestUser(prisma, {
      email: `${randomUUID()}@removed.local`,
      passwordHash: await auth.hashPassword(PASSWORD),
      role: UserRole.EMPLOYEE,
      tenantId: a.id,
    });
    userIds.push(user.id);
    await prisma.membership.create({
      data: {
        userId: user.id,
        tenantId: b.id,
        role: UserRole.EMPLOYEE,
        createdAt: new Date(Date.now() + 60_000),
      },
    });
    const tokens = await auth.login(user);
    await prisma.membership.delete({
      where: { userId_tenantId: { userId: user.id, tenantId: b.id } },
    });

    const res = await request(server)
      .get('/auth/memberships')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect(res.body).toEqual([
      { tenantId: a.id, tenantName: 'Keep Club', role: UserRole.EMPLOYEE },
    ]);
  });
});
