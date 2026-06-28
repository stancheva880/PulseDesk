import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Payment } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
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
    user?: AuthenticatedUser,
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
    const recorder = await this.prisma.user.findUnique({
      where: { id: viewer.id },
      select: { email: true, firstName: true, lastName: true },
    });
    if (!recorder) throw new NotFoundException('Recorder user not found');
    const nameSnapshot =
      [recorder.firstName, recorder.lastName].filter(Boolean).join(' ').trim() || null;

    return this.prisma.$transaction(async (tx) => {
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
          recordedByNameSnapshot: nameSnapshot,
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
    user?: AuthenticatedUser,
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
    user?: AuthenticatedUser,
  ): Promise<void> {
    const where: Prisma.FeeWhereInput = { id: feeId, tenantId };
    if (user) {
      const allowedIds = await this.scope.getAccessibleLocationIds(user, tenantId);
      if (allowedIds !== null) {
        where.class = { locations: { some: { id: { in: allowedIds } } } };
      }
    }
    const found = await this.prisma.fee.count({ where });
    if (!found) throw new NotFoundException(`Fee ${feeId} not found`);
  }
}
