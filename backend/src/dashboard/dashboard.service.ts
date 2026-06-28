import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LocationScopeService } from '@/auth/scope/location-scope.service';
import type { AuthenticatedUser } from '@/auth/types/jwt-payload';
import { PrismaService } from '@/prisma/prisma.service';

export interface FeesSummaryFilters {
  from?: string;
  to?: string;
}

export interface FeesSummaryEntry {
  period: string; // "YYYY-MM"
  collected: number;
  pending: number;
}

// Cash-flow lens: collected by `paidAt` month, billed by `Fee.periodStart` month.
// `pending` is intentionally omitted — it's an AR/billing concept, not cash-flow.
export interface CashflowSummaryEntry {
  period: string;
  collected: number;
  billed: number;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: LocationScopeService,
  ) {}

  async getFeesSummary(
    tenantId: string,
    filters: FeesSummaryFilters,
    user?: AuthenticatedUser,
  ): Promise<FeesSummaryEntry[]> {
    const { from, to } = resolveAndValidateRange(filters);
    const classFilter = await this.classScopeFilter(tenantId, user);

    const fees = await this.prisma.fee.findMany({
      where: {
        tenantId,
        periodStart: { gte: from, lte: to },
        ...classFilter,
      },
      select: {
        amount: true,
        periodStart: true,
        payments: { select: { amount: true } },
      },
    });

    const buckets = new Map<string, { billed: number; collected: number }>();
    for (const fee of fees) {
      const key = monthKey(fee.periodStart);
      const bucket = buckets.get(key) ?? { billed: 0, collected: 0 };
      bucket.billed += Number(fee.amount);
      for (const p of fee.payments) bucket.collected += Number(p.amount);
      buckets.set(key, bucket);
    }

    return enumerateMonths(from, to).map((m) => {
      const b = buckets.get(m) ?? { billed: 0, collected: 0 };
      return {
        period: m,
        collected: round2(b.collected),
        pending: round2(Math.max(0, b.billed - b.collected)),
      };
    });
  }

  async getCashflowSummary(
    tenantId: string,
    filters: FeesSummaryFilters,
    user?: AuthenticatedUser,
  ): Promise<CashflowSummaryEntry[]> {
    const { from, to } = resolveAndValidateRange(filters);
    const classFilter = await this.classScopeFilter(tenantId, user);
    // Payments scope via fee.class.locations.
    const paymentScope: Prisma.PaymentWhereInput = classFilter.class
      ? { fee: { class: classFilter.class } }
      : {};

    // Two independent queries — payments by paidAt and fees by periodStart — then
    // bucketed into the same month grid.
    const [payments, fees] = await Promise.all([
      this.prisma.payment.findMany({
        where: { tenantId, paidAt: { gte: from, lte: to }, ...paymentScope },
        select: { amount: true, paidAt: true },
      }),
      this.prisma.fee.findMany({
        where: { tenantId, periodStart: { gte: from, lte: to }, ...classFilter },
        select: { amount: true, periodStart: true },
      }),
    ]);

    const collectedByMonth = new Map<string, number>();
    for (const p of payments) {
      const key = monthKey(p.paidAt);
      collectedByMonth.set(key, (collectedByMonth.get(key) ?? 0) + Number(p.amount));
    }
    const billedByMonth = new Map<string, number>();
    for (const f of fees) {
      const key = monthKey(f.periodStart);
      billedByMonth.set(key, (billedByMonth.get(key) ?? 0) + Number(f.amount));
    }

    return enumerateMonths(from, to).map((m) => ({
      period: m,
      collected: round2(collectedByMonth.get(m) ?? 0),
      billed: round2(billedByMonth.get(m) ?? 0),
    }));
  }

  // Returns a Prisma where fragment that scopes Fee queries to the user's accessible
  // classes (via class.locations). SUPER_ADMIN and missing user → no constraint.
  private async classScopeFilter(
    tenantId: string,
    user?: AuthenticatedUser,
  ): Promise<{ class?: Prisma.ClassWhereInput }> {
    if (!user) return {};
    const allowedIds = await this.scope.getAccessibleLocationIds(user, tenantId);
    if (allowedIds === null) return {};
    return { class: { locations: { some: { id: { in: allowedIds } } } } };
  }
}

function resolveAndValidateRange(filters: FeesSummaryFilters): { from: Date; to: Date } {
  const { from, to } = resolveRange(filters);
  if (to.getTime() < from.getTime()) {
    throw new BadRequestException('"to" must be on or after "from"');
  }
  return { from, to };
}

function resolveRange(filters: FeesSummaryFilters): { from: Date; to: Date } {
  if (filters.from || filters.to) {
    const from = filters.from ? new Date(filters.from) : new Date(0);
    const to = filters.to ? new Date(filters.to) : new Date('9999-12-31');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date in from/to');
    }
    return { from: startOfMonth(from), to: endOfMonth(to) };
  }
  // Default: last 6 contiguous months ending in the current month.
  const now = new Date();
  const to = endOfMonth(now);
  const from = startOfMonth(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)),
  );
  return { from, to };
}

function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function enumerateMonths(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    out.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}
function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
