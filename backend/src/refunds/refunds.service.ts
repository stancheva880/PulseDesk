import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Refund } from '@prisma/client';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { resolveActorSnapshot } from '@/common/actor-snapshot';
import { DEFAULT_LIST_TAKE } from '@/common/dto/paginated-result';
import { FeesService } from '@/fees/fees.service';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateRefundDto } from './dto/create-refund.dto';

@Injectable()
export class RefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feesService: FeesService,
  ) {}

  async listForFee(
    tenantId: string,
    feeId: string,
    user: AuthenticatedUser,
  ): Promise<Refund[]> {
    await this.feesService.assertFeeAccessible(tenantId, feeId, user);
    return this.prisma.refund.findMany({
      where: { tenantId, feeId },
      orderBy: { refundedAt: 'desc' },
      take: DEFAULT_LIST_TAKE,
    });
  }

  async record(
    tenantId: string,
    feeId: string,
    viewer: AuthenticatedUser,
    dto: CreateRefundDto,
  ): Promise<Refund> {
    await this.feesService.assertFeeAccessible(tenantId, feeId, viewer);

    // Resolve audit-snapshot fields once.
    const recorder = await resolveActorSnapshot(
      this.prisma,
      viewer.id,
      'Recorder user not found',
    );

    return this.prisma.$transaction(async (tx) => {
      // Read net paid and insert in one transaction, like the payment guard: a check before
      // the transaction lets two concurrent refunds both see the old net and both pass.
      // ponytail: relies on the write serialisation of SQLite's default transaction; on Postgres at
      // READ COMMITTED add `SELECT … FOR UPDATE` on the fee row, or a CHECK-style DB constraint.
      const netPaid = await this.feesService.paidTotalInTransaction(tx, feeId);
      if (new Prisma.Decimal(dto.amount).gt(netPaid)) {
        throw new BadRequestException({
          message: `Refund of ${dto.amount} exceeds the net paid ${netPaid} on this fee`,
          code: 'REFUND_EXCEEDS_NET_PAID',
          params: { amount: dto.amount, netPaid: netPaid.toString() },
        });
      }

      const refund = await tx.refund.create({
        data: {
          tenantId,
          feeId,
          amount: new Prisma.Decimal(dto.amount),
          refundedAt: new Date(dto.refundedAt),
          method: dto.method,
          notes: dto.notes,
          recordedById: viewer.id,
          recordedByEmailSnapshot: recorder.email,
          recordedByNameSnapshot: recorder.nameSnapshot,
        },
      });
      await this.feesService.recomputeStatusInTransaction(tx, feeId);
      return refund;
    });
  }

  async delete(
    tenantId: string,
    feeId: string,
    refundId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.feesService.assertFeeAccessible(tenantId, feeId, user);
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId, feeId, tenantId },
    });
    if (!refund) throw new NotFoundException(`Refund ${refundId} not found`);
    await this.prisma.$transaction(async (tx) => {
      // Approved AC deviation (tech plan TKT-0105): a refunded slice may have been
      // re-collected, so removing the refund can push net paid above the fee amount — a
      // state FeeStatus cannot express. The fix path is deleting the re-collected payment first.
      const fee = await tx.fee.findUniqueOrThrow({
        where: { id: feeId },
        select: { amount: true },
      });
      const netAfter = (
        await this.feesService.paidTotalInTransaction(tx, feeId)
      ).plus(refund.amount);
      if (netAfter.gt(fee.amount)) {
        throw new BadRequestException({
          message: `Deleting this refund of ${refund.amount} would put the net paid ${netAfter} above the fee amount ${fee.amount}`,
          code: 'REFUND_DELETE_EXCEEDS_AMOUNT',
          params: {
            amount: refund.amount.toString(),
            netPaid: netAfter.toString(),
            feeAmount: fee.amount.toString(),
          },
        });
      }
      await tx.refund.delete({ where: { id: refundId } });
      await this.feesService.recomputeStatusInTransaction(tx, feeId);
    });
  }
}
