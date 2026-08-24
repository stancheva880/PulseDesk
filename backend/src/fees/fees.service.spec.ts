import { SUPER_ADMIN_USER as su } from '@/test-utils/auth-user';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BillingMode, FeeStatus, UserRole } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SessionsService } from '@/sessions/sessions.service';
import { FeesService } from './fees.service';
import { createTestUser } from '@/test-utils/create-user';

describe('FeesService', () => {
  let service: FeesService;
  let sessions: SessionsService;
  let prisma: PrismaService;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [FeesService, SessionsService, LocationScopeService, PrismaService],
    }).compile();
    service = moduleRef.get(FeesService);
    sessions = moduleRef.get(SessionsService);
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
  async function newLocation(tenantId: string) {
    return prisma.location.create({ data: { tenantId, name: `Loc-${randomUUID()}` } });
  }
  async function newTrainee(tenantId: string) {
    return prisma.trainee.create({
      data: { tenantId, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
    });
  }
  async function newMonthlyClass(tenantId: string, traineeIds: string[] = [], monthly = 100) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: monthly,
        trainees: traineeIds.length
          ? { connect: traineeIds.map((id) => ({ id })) }
          : undefined,
      },
    });
  }
  async function newSessionClass(tenantId: string, traineeIds: string[] = [], price = 25) {
    return prisma.class.create({
      data: {
        tenantId,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_SESSION,
        sessionPrice: price,
        trainees: traineeIds.length
          ? { connect: traineeIds.map((id) => ({ id })) }
          : undefined,
      },
    });
  }
  async function makeSession(tenantId: string, classId: string, locationId: string, startsAt: string) {
    return sessions.create(tenantId, {
      classId,
      locationId,
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString(),
    }, su);
  }

  // --- create / update / delete (single) ---

  describe('create / update / delete', () => {
    it('admin creates a single fee for a trainee in a class', async () => {
      const t = await newTenant();
      const tr = await newTrainee(t.id);
      const cls = await newMonthlyClass(t.id, [tr.id]);
      const fee = await service.create(t.id, {
        classId: cls.id,
        traineeId: tr.id,
        amount: 50,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        notes: 'ad-hoc',
      }, su);
      expect(fee.tenantId).toBe(t.id);
      expect(fee.status).toBe(FeeStatus.UNPAID);
      expect(Number(fee.amount)).toBe(50);
    });

    it('rejects when classId is from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const tr = await newTrainee(a.id);
      const classB = await newMonthlyClass(b.id);
      await expect(
        service.create(a.id, {
          classId: classB.id,
          traineeId: tr.id,
          amount: 50,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when traineeId is from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const cls = await newMonthlyClass(a.id);
      const traineeB = await newTrainee(b.id);
      await expect(
        service.create(a.id, {
          classId: cls.id,
          traineeId: traineeB.id,
          amount: 50,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when periodEnd is before periodStart', async () => {
      const t = await newTenant();
      const tr = await newTrainee(t.id);
      const cls = await newMonthlyClass(t.id, [tr.id]);
      await expect(
        service.create(t.id, {
          classId: cls.id,
          traineeId: tr.id,
          amount: 50,
          periodStart: '2026-03-31',
          periodEnd: '2026-03-01',
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('update changes amount and notes', async () => {
      const t = await newTenant();
      const tr = await newTrainee(t.id);
      const cls = await newMonthlyClass(t.id, [tr.id]);
      const fee = await service.create(t.id, {
        classId: cls.id,
        traineeId: tr.id,
        amount: 50,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      const updated = await service.update(t.id, fee.id, { amount: 75, notes: 'discount' }, su);
      expect(Number(updated.amount)).toBe(75);
      expect(updated.notes).toBe('discount');
    });

    // Changing the amount changes what "paid in full" means, and only the payment paths used to
    // recompute the status. Lowering an amount under the paid total left a settled fee reading
    // PARTIAL; raising it above left a PAID fee that in fact owes money.
    describe('status follows a changed amount', () => {
      async function feeWithPayment(amount: number, paid: number) {
        const t = await newTenant();
        const tr = await newTrainee(t.id);
        const cls = await newMonthlyClass(t.id, [tr.id]);
        const fee = await service.create(t.id, {
          classId: cls.id,
          traineeId: tr.id,
          amount,
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
        }, su);
        await prisma.payment.create({
          data: { tenantId: t.id, feeId: fee.id, amount: paid, paidAt: new Date('2026-03-15') },
        });
        return { tenantId: t.id, feeId: fee.id };
      }

      it('lowering the amount to the paid total settles the fee', async () => {
        const { tenantId, feeId } = await feeWithPayment(100, 40);
        // 40 of 100 paid. The recompute the payment left behind is not run here, so seed it.
        await prisma.fee.update({ where: { id: feeId }, data: { status: FeeStatus.PARTIAL } });

        const updated = await service.update(tenantId, feeId, { amount: 40 }, su);

        expect(updated.status).toBe(FeeStatus.PAID);
      });

      // The other door into an overpaid fee: no payment is inserted, the fee simply shrinks under
      // what has already been taken. Same rule as PaymentsService.record, or the guard is a fence
      // with one side missing.
      it('refuses to lower the amount below the recorded payments', async () => {
        const { tenantId, feeId } = await feeWithPayment(100, 40);

        await expect(service.update(tenantId, feeId, { amount: 39 }, su)).rejects.toBeInstanceOf(
          BadRequestException,
        );

        const unchanged = await prisma.fee.findUnique({ where: { id: feeId } });
        expect(Number(unchanged?.amount)).toBe(100);
      });

      it('raising the amount above the paid total reopens a settled fee', async () => {
        const { tenantId, feeId } = await feeWithPayment(40, 40);
        await prisma.fee.update({ where: { id: feeId }, data: { status: FeeStatus.PAID } });

        const updated = await service.update(tenantId, feeId, { amount: 100 }, su);

        expect(updated.status).toBe(FeeStatus.PARTIAL);
      });

      it('leaves the status alone when the amount is not part of the change', async () => {
        const { tenantId, feeId } = await feeWithPayment(100, 40);
        await prisma.fee.update({ where: { id: feeId }, data: { status: FeeStatus.PARTIAL } });

        const updated = await service.update(tenantId, feeId, { notes: 'no money moved' }, su);

        expect(updated.status).toBe(FeeStatus.PARTIAL);
      });
    });

    it('cross-tenant update returns NotFound', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const tr = await newTrainee(a.id);
      const cls = await newMonthlyClass(a.id, [tr.id]);
      const fee = await service.create(a.id, {
        classId: cls.id,
        traineeId: tr.id,
        amount: 50,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await expect(
        service.update(b.id, fee.id, { amount: 1 }, su),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('delete cascades payments', async () => {
      const t = await newTenant();
      const tr = await newTrainee(t.id);
      const cls = await newMonthlyClass(t.id, [tr.id]);
      const fee = await service.create(t.id, {
        classId: cls.id,
        traineeId: tr.id,
        amount: 50,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await prisma.payment.create({
        data: { tenantId: t.id, feeId: fee.id, amount: 10, paidAt: new Date('2026-03-15') },
      });
      await service.delete(t.id, fee.id, su);
      const orphaned = await prisma.payment.count({ where: { feeId: fee.id } });
      expect(orphaned).toBe(0);
    });
  });

  // --- list with filters ---

  describe('list with filters', () => {
    it('filters by status', async () => {
      const t = await newTenant();
      const tr = await newTrainee(t.id);
      const cls = await newMonthlyClass(t.id, [tr.id]);
      const fee1 = await service.create(t.id, {
        classId: cls.id,
        traineeId: tr.id,
        amount: 50,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await service.create(t.id, {
        classId: cls.id,
        traineeId: tr.id,
        amount: 70,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
      }, su);
      await prisma.fee.update({ where: { id: fee1.id }, data: { status: FeeStatus.PAID } });
      const result = await service.list(t.id, { status: FeeStatus.PAID }, su);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe(fee1.id);
    });

    it('filters by classId and traineeId', async () => {
      const t = await newTenant();
      const tr1 = await newTrainee(t.id);
      const tr2 = await newTrainee(t.id);
      const cls = await newMonthlyClass(t.id, [tr1.id, tr2.id]);
      const f1 = await service.create(t.id, {
        classId: cls.id,
        traineeId: tr1.id,
        amount: 50,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await service.create(t.id, {
        classId: cls.id,
        traineeId: tr2.id,
        amount: 50,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      const result = await service.list(t.id, { traineeId: tr1.id }, su);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe(f1.id);
    });

    it('attaches paid aggregate per row (sum of payments) — 0 when no payments', async () => {
      const t = await newTenant();
      const tr = await newTrainee(t.id);
      const cls = await newMonthlyClass(t.id, [tr.id]);
      const fee = await service.create(t.id, {
        classId: cls.id,
        traineeId: tr.id,
        amount: 100,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      // Two partial payments — paid should reflect the sum.
      await prisma.payment.create({
        data: { tenantId: t.id, feeId: fee.id, amount: 30, paidAt: new Date('2026-03-10') },
      });
      await prisma.payment.create({
        data: { tenantId: t.id, feeId: fee.id, amount: 25, paidAt: new Date('2026-03-20') },
      });
      // Second fee with no payments.
      const tr2 = await prisma.trainee.create({
        data: { tenantId: t.id, firstName: 'B', lastName: 'B', dateOfBirth: new Date('2000-01-01') },
      });
      await service.create(t.id, {
        classId: cls.id,
        traineeId: tr2.id,
        amount: 50,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);

      const rows = await service.list(t.id, {}, su);
      const byId = new Map(rows.items.map((r) => [r.id, r]));
      expect(Number(byId.get(fee.id)?.paid)).toBe(55);
      expect(rows.items.find((r) => r.id !== fee.id)?.paid).toBe('0');
    });

    it('filters by period range (overlap with given window)', async () => {
      const t = await newTenant();
      const tr = await newTrainee(t.id);
      const cls = await newMonthlyClass(t.id, [tr.id]);
      const march = await service.create(t.id, {
        classId: cls.id,
        traineeId: tr.id,
        amount: 50,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await service.create(t.id, {
        classId: cls.id,
        traineeId: tr.id,
        amount: 50,
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
      }, su);
      const result = await service.list(t.id, {
        periodStartFrom: '2026-03-01',
        periodStartTo: '2026-03-31',
      }, su);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.id).toBe(march.id);
    });
  });

  // --- generateMonthly ---

  describe('generateMonthly', () => {
    it('creates one fee per trainee per PER_MONTH class for the period (skips PER_SESSION classes)', async () => {
      const t = await newTenant();
      const tr1 = await newTrainee(t.id);
      const tr2 = await newTrainee(t.id);
      const monthly = await newMonthlyClass(t.id, [tr1.id, tr2.id], 120);
      // PER_SESSION class — must NOT be picked up by monthly generation
      await newSessionClass(t.id, [tr1.id], 25);

      const result = await service.generateMonthly(t.id, {
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      expect(result).toEqual({ created: 2, skipped: 0 });
      const fees = await prisma.fee.findMany({ where: { tenantId: t.id } });
      expect(fees).toHaveLength(2);
      expect(fees.every((f) => f.classId === monthly.id)).toBe(true);
      expect(fees.every((f) => Number(f.amount) === 120)).toBe(true);
      expect(fees.every((f) => f.sessionId === null)).toBe(true);
    });

    it('is idempotent — re-running returns 0 created and the right skipped count', async () => {
      const t = await newTenant();
      const tr1 = await newTrainee(t.id);
      const tr2 = await newTrainee(t.id);
      await newMonthlyClass(t.id, [tr1.id, tr2.id], 120);

      const first = await service.generateMonthly(t.id, {
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      expect(first).toEqual({ created: 2, skipped: 0 });

      const second = await service.generateMonthly(t.id, {
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      expect(second).toEqual({ created: 0, skipped: 2 });
      const fees = await prisma.fee.count({ where: { tenantId: t.id } });
      expect(fees).toBe(2);
    });

    it('respects classId filter — only generates for the chosen class', async () => {
      const t = await newTenant();
      const tr = await newTrainee(t.id);
      const a = await newMonthlyClass(t.id, [tr.id], 100);
      await newMonthlyClass(t.id, [tr.id], 200);
      const result = await service.generateMonthly(t.id, {
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
        classId: a.id,
      }, su);
      expect(result.created).toBe(1);
      const fees = await prisma.fee.findMany({ where: { tenantId: t.id } });
      expect(fees).toHaveLength(1);
      expect(fees[0]!.classId).toBe(a.id);
    });

    it('rejects classId from another tenant', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const classB = await newMonthlyClass(b.id);
      await expect(
        service.generateMonthly(a.id, {
          periodStart: '2026-03-01',
          periodEnd: '2026-03-31',
          classId: classB.id,
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // --- generateSessionFees ---

  describe('generateSessionFees', () => {
    it('creates one fee per (trainee, session) for PER_SESSION classes in the date range', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const tr1 = await newTrainee(t.id);
      const tr2 = await newTrainee(t.id);
      const cls = await newSessionClass(t.id, [tr1.id, tr2.id], 25);
      await makeSession(t.id, cls.id, loc.id, '2026-06-01T18:00:00.000Z');
      await makeSession(t.id, cls.id, loc.id, '2026-06-08T18:00:00.000Z');

      const result = await service.generateSessionFees(t.id, {
        from: '2026-06-01',
        to: '2026-06-30',
      }, su);
      expect(result).toEqual({ created: 4, skipped: 0 });
      const fees = await prisma.fee.findMany({ where: { tenantId: t.id } });
      expect(fees).toHaveLength(4);
      expect(fees.every((f) => Number(f.amount) === 25)).toBe(true);
      expect(fees.every((f) => f.sessionId !== null)).toBe(true);
    });

    it('skips sessions whose class is PER_MONTH (only PER_SESSION classes generate session fees)', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const tr = await newTrainee(t.id);
      const monthlyClass = await newMonthlyClass(t.id, [tr.id]);
      await makeSession(t.id, monthlyClass.id, loc.id, '2026-06-01T18:00:00.000Z');

      const result = await service.generateSessionFees(t.id, {
        from: '2026-06-01',
        to: '2026-06-30',
      }, su);
      expect(result.created).toBe(0);
    });

    it('is idempotent — re-running skips existing (trainee, session) fees', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const tr = await newTrainee(t.id);
      const cls = await newSessionClass(t.id, [tr.id], 25);
      await makeSession(t.id, cls.id, loc.id, '2026-06-01T18:00:00.000Z');

      const first = await service.generateSessionFees(t.id, {
        from: '2026-06-01',
        to: '2026-06-30',
      }, su);
      expect(first).toEqual({ created: 1, skipped: 0 });

      const second = await service.generateSessionFees(t.id, {
        from: '2026-06-01',
        to: '2026-06-30',
      }, su);
      expect(second).toEqual({ created: 0, skipped: 1 });
    });

    it('respects classId filter', async () => {
      const t = await newTenant();
      const loc = await newLocation(t.id);
      const tr = await newTrainee(t.id);
      const a = await newSessionClass(t.id, [tr.id], 25);
      const b = await newSessionClass(t.id, [tr.id], 30);
      await makeSession(t.id, a.id, loc.id, '2026-06-01T18:00:00.000Z');
      await makeSession(t.id, b.id, loc.id, '2026-06-02T18:00:00.000Z');

      const result = await service.generateSessionFees(t.id, {
        from: '2026-06-01',
        to: '2026-06-30',
        classId: a.id,
      }, su);
      expect(result.created).toBe(1);
      const fees = await prisma.fee.findMany({ where: { tenantId: t.id } });
      expect(fees).toHaveLength(1);
      expect(fees[0]!.classId).toBe(a.id);
    });

    it('rejects when "to" is before "from"', async () => {
      const t = await newTenant();
      await expect(
        service.generateSessionFees(t.id, {
          from: '2026-06-30',
          to: '2026-06-01',
        }, su),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // --- listForCustomer ---

  describe('listForCustomer', () => {
    it('returns fees for trainees the customer owns or guards (with class + trainee + payments)', async () => {
      const t = await newTenant();
      const customer = await createTestUser(prisma, {
        tenantId: t.id,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.CUSTOMER,
      });
      // Self-trainee + guarded child
      const self = await prisma.trainee.create({
        data: {
          tenantId: t.id,
          firstName: 'Self',
          lastName: 'A',
          dateOfBirth: new Date('1990-01-01'),
          userId: customer.id,
        },
      });
      const child = await prisma.trainee.create({
        data: {
          tenantId: t.id,
          firstName: 'Kid',
          lastName: 'B',
          dateOfBirth: new Date('2015-01-01'),
          guardians: { connect: [{ id: customer.id }] },
        },
      });
      // Stranger trainee — must not appear
      const stranger = await prisma.trainee.create({
        data: { tenantId: t.id, firstName: 'X', lastName: 'X', dateOfBirth: new Date('1990-01-01') },
      });
      const cls = await newMonthlyClass(t.id, [self.id, child.id, stranger.id], 100);

      const selfFee = await service.create(t.id, {
        classId: cls.id,
        traineeId: self.id,
        amount: 100,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await service.create(t.id, {
        classId: cls.id,
        traineeId: child.id,
        amount: 100,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await service.create(t.id, {
        classId: cls.id,
        traineeId: stranger.id,
        amount: 100,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      await prisma.payment.create({
        data: { tenantId: t.id, feeId: selfFee.id, amount: 30, paidAt: new Date('2026-03-15') },
      });

      const result = await service.listForCustomer(t.id, customer.id);
      expect(result).toHaveLength(2);
      const ids = new Set(result.map((f) => f.traineeId));
      expect(ids).toEqual(new Set([self.id, child.id]));
      const selfRow = result.find((f) => f.traineeId === self.id)!;
      expect(selfRow.class?.name).toBe(cls.name);
      expect(selfRow.trainee.firstName).toBe('Self');
      expect(selfRow.payments).toHaveLength(1);
      expect(Number(selfRow.payments[0]!.amount)).toBe(30);
    });

    it('cross-tenant isolation: customer in tenant A does not see fees in tenant B', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const trainee = await newTrainee(b.id);
      const cls = await newMonthlyClass(b.id, [trainee.id]);
      await service.create(b.id, {
        classId: cls.id,
        traineeId: trainee.id,
        amount: 100,
        periodStart: '2026-03-01',
        periodEnd: '2026-03-31',
      }, su);
      const customer = await createTestUser(prisma, {
        tenantId: a.id,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.CUSTOMER,
      });
      const result = await service.listForCustomer(a.id, customer.id);
      expect(result).toHaveLength(0);
    });
  });
});
