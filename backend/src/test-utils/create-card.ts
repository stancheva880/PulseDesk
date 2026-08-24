import type { Card } from '@prisma/client';
import type { PrismaService } from '@/prisma/prisma.service';

// Spec-only fixture: a card and its purchase fee, the shape CardsService.create writes
// (TKT-0106). Defaults make an active, never-expiring, tenant-wide card.
interface TestCardData {
  tenantId: string;
  traineeId: string;
  classId?: string | null;
  totalVisits: number;
  price?: number;
  expiresAt?: Date | null;
  cancelledAt?: Date | null;
}

export async function createTestCard(prisma: PrismaService, data: TestCardData): Promise<Card> {
  const purchaseDay = new Date('2026-01-01T00:00:00.000Z');
  const fee = await prisma.fee.create({
    data: {
      tenantId: data.tenantId,
      classId: data.classId ?? null,
      traineeId: data.traineeId,
      periodStart: purchaseDay,
      periodEnd: purchaseDay,
      amount: data.price ?? 100,
    },
  });
  return prisma.card.create({
    data: {
      tenantId: data.tenantId,
      traineeId: data.traineeId,
      classId: data.classId ?? null,
      feeId: fee.id,
      totalVisits: data.totalVisits,
      price: data.price ?? 100,
      expiresAt: data.expiresAt ?? null,
      cancelledAt: data.cancelledAt ?? null,
    },
  });
}
