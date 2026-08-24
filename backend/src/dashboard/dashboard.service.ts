import { BadRequestException, Injectable } from '@nestjs/common';
import { endOfMonth, startOfMonth } from '@/common/dates';
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
    user: AuthenticatedUser,
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
    user: AuthenticatedUser,
  ): Promise<CashflowSummaryEntry[]> {
    const { from, to } = resolveAndValidateRange(filters);
    const classFilter = await this.classScopeFilter(tenantId, user);
    // Payments scope via fee.class.locations (class-less fees included, TKT-0106).
    const paymentScope: Prisma.PaymentWhereInput = classFilter.OR
      ? { fee: classFilter }
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
  // classes (via class.locations). Class-less (card purchase) fees are tenant-level
  // money and always pass (TKT-0106). SUPER_ADMIN → no constraint.
  private async classScopeFilter(
    tenantId: string,
    user: AuthenticatedUser,
  ): Promise<Pick<Prisma.FeeWhereInput, 'OR'>> {
    const scoped = await this.scope.locationsWhere(user, tenantId);
    return scoped.locations ? { OR: [{ classId: null }, { class: scoped }] } : {};
  }
}

// The result is one entry per month in [from, to], so an unbounded range is a denial of
// service on the client: an open `to` used to reach year 9999 (~96k entries, ~4.6 MB)
// and froze the browser. Both ends are bounded and the span is capped.
const MAX_MONTHS = 120;
const DEFAULT_MONTHS = 6;

function resolveAndValidateRange(filters: FeesSummaryFilters): { from: Date; to: Date } {
  const now = new Date();
  const fromRaw = filters.from ? new Date(filters.from) : null;
  const toRaw = filters.to ? new Date(filters.to) : null;
  if (
    (fromRaw && Number.isNaN(fromRaw.getTime())) ||
    (toRaw && Number.isNaN(toRaw.getTime()))
  ) {
    throw new BadRequestException('Invalid date in from/to');
  }

  // An omitted `to` means "until now" — unless `from` is in the future, where it means
  // that single month. An omitted `from` means the default window back from `to`. With
  // neither, this is the last 6 contiguous months ending in the current month.
  const to = endOfMonth(
    toRaw ?? (fromRaw && fromRaw.getTime() > now.getTime() ? fromRaw : now),
  );
  const from = startOfMonth(
    fromRaw ??
      new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (DEFAULT_MONTHS - 1), 1)),
  );

  // Compare month-rounded (same-month inverted inputs are fine).
  if (to.getTime() < from.getTime()) {
    throw new BadRequestException('"to" must be on or after "from"');
  }
  if (monthSpan(from, to) > MAX_MONTHS) {
    throw new BadRequestException(`Range too large: max ${MAX_MONTHS} months`);
  }
  return { from, to };
}

function monthSpan(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth()) +
    1
  );
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
