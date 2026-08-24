import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Card } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import {
  buildPaginatedResult,
  normalizePagination,
  DEFAULT_LIST_TAKE,
  type PaginatedResult,
  type PaginationInput,
} from '@/common/dto/paginated-result';
import { assertClassInTenant, assertTraineeInTenant } from '@/common/tenant-guards';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateCardDto } from './dto/create-card.dto';
import type { ListCardsQueryDto } from './dto/list-cards-query.dto';

export type CardRow = Card & { visitsUsed: number; visitsRemaining: number };

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async create(tenantId: string, dto: CreateCardDto, user: AuthenticatedUser): Promise<CardRow> {
    await assertTraineeInTenant(this.prisma, tenantId, dto.traineeId);
    if (dto.classId) {
      await assertClassInTenant(this.prisma, tenantId, dto.classId);
      await this.assertClassAccessible(user, tenantId, dto.classId);
    }

    // The purchase fee and the card are one sale — created together or not at all.
    // The fee's period is the purchase day; classId stays null for tenant-wide cards.
    const today = new Date();
    const purchaseDay = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const card = await this.prisma.$transaction(async (tx) => {
      const fee = await tx.fee.create({
        data: {
          tenantId,
          classId: dto.classId ?? null,
          traineeId: dto.traineeId,
          periodStart: purchaseDay,
          periodEnd: purchaseDay,
          amount: new Prisma.Decimal(dto.price),
        },
      });
      return tx.card.create({
        data: {
          tenantId,
          traineeId: dto.traineeId,
          classId: dto.classId ?? null,
          feeId: fee.id,
          totalVisits: dto.totalVisits,
          price: new Prisma.Decimal(dto.price),
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
      });
    });
    return { ...card, visitsUsed: 0, visitsRemaining: card.totalVisits };
  }

  async list(
    tenantId: string,
    filters: ListCardsQueryDto,
    user: AuthenticatedUser,
    pagination?: PaginationInput,
  ): Promise<PaginatedResult<CardRow>> {
    const where: Prisma.CardWhereInput = { tenantId };
    if (filters.traineeId) where.traineeId = filters.traineeId;

    // TKT-0123: the same scope rule create and cancel already apply, and the same one GET /fees
    // uses for the money these cards are sold through — a class-scoped card belongs to that
    // class's location admins, a whole-club card (classId null) is tenant-level money everyone
    // administering the club can see.
    const scoped = await this.scope.locationsWhere(user, tenantId);
    if (scoped.locations) {
      where.OR = [{ classId: null }, { class: scoped }];
    }

    const p = normalizePagination(pagination);
    const [cards, total] = await this.prisma.$transaction([
      this.prisma.card.findMany({
        where,
        include: { _count: { select: { consumptions: true } } },
        orderBy: { createdAt: 'desc' },
        skip: p.skip,
        take: p.take,
      }),
      this.prisma.card.count({ where }),
    ]);
    const items = cards.map(({ _count, ...card }) => ({
      ...card,
      visitsUsed: _count.consumptions,
      visitsRemaining: card.totalVisits - _count.consumptions,
    }));
    return buildPaginatedResult(items, total, p);
  }

  /**
   * TKT-0116: the portal's card list — the customer's linked or guarded trainees only,
   * same server-side family filter as FeesService.listForCustomer. Cancelled cards stay
   * listed: the flag is the information the portal renders.
   */
  async listForCustomer(tenantId: string, customerUserId: string) {
    const cards = await this.prisma.card.findMany({
      where: {
        tenantId,
        trainee: {
          OR: [
            { userId: customerUserId },
            { guardians: { some: { id: customerUserId } } },
          ],
        },
      },
      include: {
        _count: { select: { consumptions: true } },
        class: { select: { id: true, name: true } },
        trainee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: DEFAULT_LIST_TAKE,
    });
    return cards.map((card) => ({
      id: card.id,
      traineeId: card.traineeId,
      totalVisits: card.totalVisits,
      visitsUsed: card._count.consumptions,
      visitsRemaining: card.totalVisits - card._count.consumptions,
      expiresAt: card.expiresAt,
      cancelledAt: card.cancelledAt,
      class: card.class,
      trainee: card.trainee,
    }));
  }

  // TKT-0115: one-way. Setting cancelledAt is the whole switch-off — consumption and the
  // candidates' card info both read usableCardsByTrainee, which filters cancelled cards.
  // Existing consumption rows stay; the refund (if any) goes through the refunds endpoint.
  async cancel(tenantId: string, id: string, user: AuthenticatedUser): Promise<CardRow> {
    const card = await this.prisma.card.findFirst({ where: { id, tenantId } });
    if (!card) throw new NotFoundException(`Card ${id} not found`);
    // Same scope rule as create: class-scoped cards belong to that class's location admins.
    if (card.classId) await this.assertClassAccessible(user, tenantId, card.classId);
    if (card.cancelledAt) {
      throw new BadRequestException({
        message: 'This card is already cancelled',
        code: 'CARD_ALREADY_CANCELLED',
      });
    }
    const updated = await this.prisma.card.update({
      where: { id },
      data: { cancelledAt: new Date() },
      include: { _count: { select: { consumptions: true } } },
    });
    const { _count, ...row } = updated;
    return {
      ...row,
      visitsUsed: _count.consumptions,
      visitsRemaining: row.totalVisits - _count.consumptions,
    };
  }

  // Same rule as FeesService: an ADMIN may only sell class-scoped cards for classes
  // in their locations. Tenant-wide cards carry no class and skip this.
  private async assertClassAccessible(
    user: AuthenticatedUser,
    tenantId: string,
    classId: string,
  ): Promise<void> {
    const scoped = await this.scope.locationsWhere(user, tenantId);
    if (!scoped.locations) return;
    const ok = await this.prisma.class.count({
      where: { id: classId, tenantId, ...scoped },
    });
    if (!ok) throw new NotFoundException(`Class ${classId} not found`);
  }
}
