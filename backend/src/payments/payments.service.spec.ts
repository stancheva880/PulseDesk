import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BillingMode, FeeStatus, UserRole } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import { PrismaService } from '@/prisma/prisma.service';
import { FeesService } from '@/fees/fees.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let fees: FeesService;
  let prisma: PrismaService;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [PaymentsService, FeesService, LocationScopeService, PrismaService],
    }).compile();
    service = moduleRef.get(PaymentsService);
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

  async function setup(amount = 100) {
    const tenant = await prisma.tenant.create({
      data: { name: 'Test', slug: `t-${randomUUID()}` },
    });
    tenantIds.push(tenant.id);
    const trainee = await prisma.trainee.create({
      data: { tenantId: tenant.id, firstName: 'T', lastName: 'X', dateOfBirth: new Date('2000-01-01') },
    });
    const cls = await prisma.class.create({
      data: {
        tenantId: tenant.id,
        name: `Cls-${randomUUID()}`,
        billingMode: BillingMode.PER_MONTH,
        monthlyAmount: amount,
        trainees: { connect: [{ id: trainee.id }] },
      },
    });
    const fee = await fees.create(tenant.id, {
      classId: cls.id,
      traineeId: trainee.id,
      amount,
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
    });
    const recorder = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `${randomUUID()}@x`,
        passwordHash: 'x',
        role: UserRole.ADMIN,
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    });
    return { tenantId: tenant.id, fee, recorder };
  }

  // These tests assert "no scope filter" semantics. With ADMIN now location-scoped,
  // that maps to SUPER_ADMIN. The audit snapshot still uses the recorder user looked
  // up by viewer.id, so the snapshot fields reflect the actual user record.
  function viewer(_tenantId: string, userId: string, _role: UserRole = UserRole.ADMIN) {
    return { id: userId, email: 'a@x', role: UserRole.SUPER_ADMIN, tenantId: null } as const;
  }

  // --- record ---

  describe('record', () => {
    it('insert covering full amount sets fee.status = PAID', async () => {
      const { tenantId, fee, recorder } = await setup(100);
      await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 100,
        paidAt: '2026-03-15',
      });
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PAID);
    });

    it('insert covering part of the amount sets fee.status = PARTIAL', async () => {
      const { tenantId, fee, recorder } = await setup(100);
      await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 40,
        paidAt: '2026-03-15',
      });
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PARTIAL);
    });

    it('multiple partial payments summing >= amount mark the fee PAID', async () => {
      const { tenantId, fee, recorder } = await setup(100);
      await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 40,
        paidAt: '2026-03-10',
      });
      await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 60,
        paidAt: '2026-03-20',
      });
      const updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PAID);
    });

    it('writes audit snapshot fields from the recording user', async () => {
      const { tenantId, fee, recorder } = await setup(100);
      const payment = await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 100,
        paidAt: '2026-03-15',
      });
      expect(payment.recordedById).toBe(recorder.id);
      expect(payment.recordedByEmailSnapshot).toBe(recorder.email);
      expect(payment.recordedByNameSnapshot).toBe('Ada Lovelace');
    });

    it('cross-tenant fee returns NotFound (no payment created)', async () => {
      const a = await setup(100);
      const b = await setup(50);
      await expect(
        service.record(b.tenantId, a.fee.id, viewer(b.tenantId, b.recorder.id), {
          amount: 100,
          paidAt: '2026-03-15',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      const count = await prisma.payment.count({ where: { feeId: a.fee.id } });
      expect(count).toBe(0);
    });
  });

  // --- listForFee ---

  describe('listForFee', () => {
    it('lists payments scoped to (tenantId, feeId)', async () => {
      const { tenantId, fee, recorder } = await setup(200);
      await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 100,
        paidAt: '2026-03-10',
      });
      await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 50,
        paidAt: '2026-03-15',
      });
      const rows = await service.listForFee(tenantId, fee.id);
      expect(rows).toHaveLength(2);
    });

    it('cross-tenant returns NotFound', async () => {
      const a = await setup(100);
      const b = await setup(50);
      await expect(service.listForFee(b.tenantId, a.fee.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // --- delete ---

  describe('delete', () => {
    it('removes a payment and recomputes fee.status (PAID → PARTIAL on partial removal)', async () => {
      const { tenantId, fee, recorder } = await setup(100);
      const p1 = await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 70,
        paidAt: '2026-03-10',
      });
      await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 30,
        paidAt: '2026-03-15',
      });
      let updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PAID);
      await service.delete(tenantId, fee.id, p1.id);
      updated = await prisma.fee.findUnique({ where: { id: fee.id } });
      expect(updated?.status).toBe(FeeStatus.PARTIAL);
    });

    it('deleting all payments returns the fee to UNPAID', async () => {
      const { tenantId, fee, recorder } = await setup(100);
      const p = await service.record(tenantId, fee.id, viewer(tenantId, recorder.id), {
        amount: 100,
        paidAt: '2026-03-15',
      });
      expect((await prisma.fee.findUnique({ where: { id: fee.id } }))?.status).toBe(
        FeeStatus.PAID,
      );
      await service.delete(tenantId, fee.id, p.id);
      expect((await prisma.fee.findUnique({ where: { id: fee.id } }))?.status).toBe(
        FeeStatus.UNPAID,
      );
    });

    it('cross-tenant delete returns NotFound', async () => {
      const a = await setup(100);
      const b = await setup(50);
      const p = await service.record(a.tenantId, a.fee.id, viewer(a.tenantId, a.recorder.id), {
        amount: 50,
        paidAt: '2026-03-10',
      });
      await expect(service.delete(b.tenantId, a.fee.id, p.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
