import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Payment } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { resolveActorSnapshot } from '@/common/actor-snapshot';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { FeesService } from '@/fees/fees.service';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feesService: FeesService,
    private readonly scope: LocationScopeService,
  ) {}

  async listForFee(
    tenantId: string,
    feeId: string,
    user: AuthenticatedUser,
  ): Promise<Payment[]> {
    await this.assertFeeAccessible(tenantId, feeId, user);
    return this.prisma.payment.findMany({
      where: { tenantId, feeId },
      orderBy: { paidAt: 'desc' },
      take: DEFAULT_LIST_TAKE,
    });
  }

  async record(
    tenantId: string,
    feeId: string,
    viewer: AuthenticatedUser,
    dto: CreatePaymentDto,
  ): Promise<Payment> {
    await this.assertFeeAccessible(tenantId, feeId, viewer);

    // Resolve audit-snapshot fields once.
    const recorder = await resolveActorSnapshot(
      this.prisma,
      viewer.id,
      'Recorder user not found',
    );

    return this.prisma.$transaction(async (tx) => {
      // Read the balance and insert in one transaction: a check before the transaction lets two
      // concurrent payments both see the old total and both pass.
      // ponytail: relies on the write serialisation of SQLite's default transaction; on Postgres at
      // READ COMMITTED add `SELECT … FOR UPDATE` on the fee row, or a CHECK-style DB constraint.
      const fee = await tx.fee.findUniqueOrThrow({
        where: { id: feeId },
        select: { amount: true },
      });
      const balance = fee.amount.minus(await this.feesService.paidTotalInTransaction(tx, feeId));
      if (new Prisma.Decimal(dto.amount).gt(balance)) {
        throw new BadRequestException({
          message: `Payment of ${dto.amount} exceeds the outstanding balance of ${balance} on this fee`,
          code: 'FEE_PAYMENT_EXCEEDS_BALANCE',
          params: { amount: dto.amount, balance: balance.toString() },
        });
      }

      const payment = await tx.payment.create({
        data: {
          tenantId,
          feeId,
          amount: new Prisma.Decimal(dto.amount),
          paidAt: new Date(dto.paidAt),
          method: dto.method,
          notes: dto.notes,
          recordedById: viewer.id,
          recordedByEmailSnapshot: recorder.email,
          recordedByNameSnapshot: recorder.nameSnapshot,
        },
      });
      await this.feesService.recomputeStatusInTransaction(tx, feeId);
      return payment;
    });
  }

  async delete(
    tenantId: string,
    feeId: string,
    paymentId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.assertFeeAccessible(tenantId, feeId, user);
    const found = await this.prisma.payment.count({
      where: { id: paymentId, feeId, tenantId },
    });
    if (!found) throw new NotFoundException(`Payment ${paymentId} not found`);
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.delete({ where: { id: paymentId } });
      await this.feesService.recomputeStatusInTransaction(tx, feeId);
    });
  }

  // Tenant-bound + ADMIN-location-scoped via the fee's class. SUPER_ADMIN passes through.
  private async assertFeeAccessible(
    tenantId: string,
    feeId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    const where: Prisma.FeeWhereInput = { id: feeId, tenantId };
    const scoped = await this.scope.locationsWhere(user, tenantId);
    if (scoped.locations) where.class = scoped;
    const found = await this.prisma.fee.count({ where });
    if (!found) throw new NotFoundException(`Fee ${feeId} not found`);
  }
}
