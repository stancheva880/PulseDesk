import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BillingMode, UserRole } from '@prisma/client';
import { createTestUser } from '@/test-utils/create-user';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FeesService } from '@/fees/fees.service';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let fees: FeesService;
  let prisma: PrismaService;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [DashboardService, FeesService, LocationScopeService, PrismaService],
    }).compile();
    service = moduleRef.get(DashboardService);
    fees = moduleRef.get(FeesService);
    prisma = moduleRef.get(PrismaService);
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    if (tenantIds.length) {
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.onModuleDestroy();
  });

  async function newTenant() {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test', slug: `t-${randomUUID()}` },
    });
    tenantIds.push(tenant.id);
    return tenant;
  }
  async function setupClassWithTrainee(tenantId: string) {
    const trainee = await prisma.trainee.create({
      data: { tenantId, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
    });
    const cls = await prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: 100,
        trainees: { connect: [{ id: trainee.id }] },
      },
    });
    return { traineeId: trainee.id, classId: cls.id };
  }
  async function makeFeeWithPayments(
    tenantId: string,
    classId: string,
    traineeId: string,
    periodStart: string,
    periodEnd: string,
    amount: number,
    payments: Array<{ amount: number; paidAt: string }> = [],
  ) {
    const fee = await fees.create(tenantId, {
      classId,
      traineeId,
      amount,
      periodStart,
      periodEnd,
    }, su);
    for (const p of payments) {
      await prisma.payment.create({
        data: {
          tenantId,
          feeId: fee.id,
          amount: p.amount,
          paidAt: new Date(p.paidAt),
        },
      });
    }
    return fee;
  }

  describe('getFeesSummary — explicit range', () => {
    it('returns one entry per month in [from, to] with zero-fill for months without activity', async () => {
      const t = await newTenant();
      const result = await service.getFeesSummary(t.id, {
        from: '2026-01-01',
        to: '2026-03-31',
      }, su);
      expect(result.map((r) => r.period)).toEqual(['2026-01', '2026-02', '2026-03']);
      expect(result.every((r) => r.collected === 0 && r.pending === 0)).toBe(true);
    });

    it('groups fees by Fee.periodStart month and sums amount → pending = billed - collected', async () => {
      const t = await newTenant();
      const { classId, traineeId } = await setupClassWithTrainee(t.id);
      // March: billed 100, collected 30 → pending 70
      await makeFeeWithPayments(
        t.id,
        classId,
        traineeId,
        '2026-03-01',
        '2026-03-31',
        100,
        [{ amount: 30, paidAt: '2026-03-15' }],
      );
      // April: billed 100, collected 100 → pending 0
      const trainee2 = await prisma.trainee.create({
        data: { tenantId: t.id, firstName: 'B', lastName: 'B', dateOfBirth: new Date('2000-01-01') },
      });
      await makeFeeWithPayments(
        t.id,
        classId,
        trainee2.id,
        '2026-04-01',
        '2026-04-30',
        100,
        [{ amount: 100, paidAt: '2026-04-10' }],
      );

      const result = await service.getFeesSummary(t.id, {
        from: '2026-03-01',
        to: '2026-04-30',
      }, su);
      expect(result).toEqual([
        { period: '2026-03', collected: 30, pending: 70 },
        { period: '2026-04', collected: 100, pending: 0 },
      ]);
    });

    it('aggregates multiple payments against the same fee correctly', async () => {
      const t = await newTenant();
      const { classId, traineeId } = await setupClassWithTrainee(t.id);
      await makeFeeWithPayments(
        t.id,
        classId,
        traineeId,
        '2026-03-01',
        '2026-03-31',
        100,
        [
          { amount: 40, paidAt: '2026-03-10' },
          { amount: 35, paidAt: '2026-03-20' },
        ],
      );
      const result = await service.getFeesSummary(t.id, {
        from: '2026-03-01',
        to: '2026-03-31',
      }, su);
      expect(result).toEqual([{ period: '2026-03', collected: 75, pending: 25 }]);
    });

    it('excludes fees in other tenants', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const setupB = await setupClassWithTrainee(b.id);
      await makeFeeWithPayments(
        b.id,
        setupB.classId,
        setupB.traineeId,
        '2026-03-01',
        '2026-03-31',
        500,
        [{ amount: 500, paidAt: '2026-03-15' }],
      );
      const result = await service.getFeesSummary(a.id, {
        from: '2026-03-01',
        to: '2026-03-31',
      }, su);
      expect(result).toEqual([{ period: '2026-03', collected: 0, pending: 0 }]);
    });

    it('rejects when "to" is before "from"', async () => {
      const t = await newTenant();
      await expect(
        service.getFeesSummary(t.id, { from: '2026-04-01', to: '2026-03-01' }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getFeesSummary — defaults', () => {
    it('returns 6 contiguous months when no range is provided', async () => {
      const t = await newTenant();
      const result = await service.getFeesSummary(t.id, {}, su);
      expect(result).toHaveLength(6);
      // Monotonically increasing month keys.
      const sorted = [...result].sort((a, b) => a.period.localeCompare(b.period));
      expect(result.map((r) => r.period)).toEqual(sorted.map((r) => r.period));
    });
  });

  describe('getCashflowSummary', () => {
    it('keys collected on Payment.paidAt month, NOT on Fee.periodStart month', async () => {
      const t = await newTenant();
      const { classId, traineeId } = await setupClassWithTrainee(t.id);
      // Fee billed for March, paid in April — under the cash-flow lens, the
      // April month should show the collection (the billing lens shows it under March).
      await makeFeeWithPayments(
        t.id,
        classId,
        traineeId,
        '2026-03-01',
        '2026-03-31',
        100,
        [{ amount: 100, paidAt: '2026-04-12' }],
      );
      const result = await service.getCashflowSummary(t.id, {
        from: '2026-03-01',
        to: '2026-04-30',
      }, su);
      expect(result).toEqual([
        { period: '2026-03', collected: 0, billed: 100 },
        { period: '2026-04', collected: 100, billed: 0 },
      ]);
    });

    it('zero-fills empty months and rejects bad range', async () => {
      const t = await newTenant();
      const empty = await service.getCashflowSummary(t.id, {
        from: '2026-01-01',
        to: '2026-02-28',
      }, su);
      expect(empty).toEqual([
        { period: '2026-01', collected: 0, billed: 0 },
        { period: '2026-02', collected: 0, billed: 0 },
      ]);
      await expect(
        service.getCashflowSummary(t.id, { from: '2026-04-01', to: '2026-03-01' }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cross-tenant isolation', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const setupB = await setupClassWithTrainee(b.id);
      await makeFeeWithPayments(
        b.id,
        setupB.classId,
        setupB.traineeId,
        '2026-03-01',
        '2026-03-31',
        500,
        [{ amount: 500, paidAt: '2026-03-15' }],
      );
      const result = await service.getCashflowSummary(a.id, {
        from: '2026-03-01',
        to: '2026-03-31',
      }, su);
      expect(result).toEqual([{ period: '2026-03', collected: 0, billed: 0 }]);
    });
  });

  describe('range bounds', () => {
    const currentMonth = () => new Date().toISOString().slice(0, 7);
    const isoDay = (d: Date) => d.toISOString().slice(0, 10);

    it('bounds an open "to": from-only runs to the current month, not to year 9999', async () => {
      const t = await newTenant();
      const now = new Date();
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
      const result = await service.getFeesSummary(t.id, { from: isoDay(from) }, su);
      expect(result).toHaveLength(3);
      expect(result.at(-1)?.period).toBe(currentMonth());
    });

    it('bounds an open "from": to-only returns the 6 months ending at "to"', async () => {
      const t = await newTenant();
      const result = await service.getFeesSummary(t.id, { to: '2026-06-30' }, su);
      expect(result.map((r) => r.period)).toEqual([
        '2026-01',
        '2026-02',
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
      ]);
    });

    it('a future "from" with no "to" yields that single month', async () => {
      const t = await newTenant();
      const now = new Date();
      const future = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), 1));
      const result = await service.getFeesSummary(t.id, { from: isoDay(future) }, su);
      expect(result).toEqual([
        { period: future.toISOString().slice(0, 7), collected: 0, pending: 0 },
      ]);
    });

    it('accepts a span of exactly 120 months', async () => {
      const t = await newTenant();
      const result = await service.getFeesSummary(
        t.id,
        { from: '2017-01-01', to: '2026-12-31' },
        su,
      );
      expect(result).toHaveLength(120);
    });

    it('rejects a span wider than 120 months', async () => {
      const t = await newTenant();
      await expect(
        service.getFeesSummary(t.id, { from: '1900-01-01', to: '2026-08-31' }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('getCashflowSummary bounds an open "to" the same way', async () => {
      const t = await newTenant();
      const now = new Date();
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const result = await service.getCashflowSummary(t.id, { from: isoDay(from) }, su);
      expect(result).toHaveLength(2);
      expect(result.at(-1)?.period).toBe(currentMonth());
    });

    it('getCashflowSummary rejects a span wider than 120 months', async () => {
      const t = await newTenant();
      await expect(
        service.getCashflowSummary(t.id, { from: '1900-01-01', to: '2026-08-31' }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // TKT-0106: class-less (card purchase) fees are tenant-level money — the class-location
  // scope must not drop them from a location-scoped admin's numbers.
  describe('class-less fees under location scoping', () => {
    it('cashflow includes a class-less fee and its payment for a location-scoped admin', async () => {
      const t = await newTenant();
      const location = await prisma.location.create({
        data: { tenantId: t.id, name: `Main-${randomUUID()}` },
      });
      const admin = await createTestUser(prisma, {
        email: `${randomUUID()}@x`,
        passwordHash: null,
        role: UserRole.ADMIN,
        tenantId: t.id,
        locations: { connect: [{ id: location.id }] },
      });
      const trainee = await prisma.trainee.create({
        data: { tenantId: t.id, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
      });
      const fee = await prisma.fee.create({
        data: {
          tenantId: t.id,
          classId: null,
          traineeId: trainee.id,
          periodStart: new Date('2026-03-01'),
          periodEnd: new Date('2026-03-01'),
          amount: 100,
        },
      });
      await prisma.payment.create({
        data: { tenantId: t.id, feeId: fee.id, amount: 40, paidAt: new Date('2026-03-05') },
      });

      const result = await service.getCashflowSummary(
        t.id,
        { from: '2026-03-01', to: '2026-03-31' },
        { id: admin.id, email: admin.email, role: UserRole.ADMIN, tenantId: t.id },
      );
      expect(result).toEqual([{ period: '2026-03', collected: 40, billed: 100 }]);
    });
  });
});
