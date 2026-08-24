'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { useAuth } from '@/components/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PageInfo } from '@/components/table-pagination';
import { showToast } from '@/components/toast';
import { apiErrorMessage } from '@/lib/api';
import { isManager } from '@/lib/auth-storage';
import {
  Cards,
  Refunds,
  Trainees,
  Classes,
  listAll,
  type CardRow,
  type ClassRow,
  type Trainee,
} from '@/lib/api-resources';
import { formatMoney, parseAmount } from '@/lib/utils';

interface CardRowVM {
  card: CardRow;
  traineeName: string;
  scopeName: string;
}

export default function CardsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);

  const [rows, setRows] = useState<CardRow[] | null>(null);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Cancel-with-refund dialog (TKT-0115)
  const [cancelTarget, setCancelTarget] = useState<CardRow | null>(null);
  const [cancelAmount, setCancelAmount] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  useEffect(() => {
    Cards.list({ page })
      .then((r) => {
        setRows(r.items);
        setPageInfo(r);
      })
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  }, [page, refreshKey]);

  useEffect(() => {
    Promise.all([listAll(Trainees.list), listAll(Classes.list)])
      .then(([tr, c]) => {
        setTrainees(tr);
        setClasses(c);
      })
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  }, []);

  const traineeNameById = useMemo(
    () => new Map(trainees.map((tr) => [tr.id, `${tr.firstName} ${tr.lastName}`])),
    [trainees],
  );
  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);

  const data: CardRowVM[] | null = useMemo(
    () =>
      rows === null
        ? null
        : rows.map((card) => ({
            card,
            traineeName: traineeNameById.get(card.traineeId) ?? '—',
            scopeName: card.classId
              ? (classNameById.get(card.classId) ?? '—')
              : t('cards.wholeClub'),
          })),
    [rows, traineeNameById, classNameById, t],
  );

  const openCancel = (card: CardRow) => {
    // PRD-0015: suggested refund = price / totalVisits × visitsRemaining, 2 decimals —
    // a pre-fill the admin edits, never an amount written unreviewed.
    const suggested =
      Math.round((Number(card.price) / card.totalVisits) * card.visitsRemaining * 100) / 100;
    setCancelAmount(suggested.toFixed(2));
    setCancelError(null);
    setCancelTarget(card);
  };

  const onConfirmCancel = async () => {
    if (!cancelTarget) return;
    const raw = cancelAmount.trim();
    // Same money rule as everywhere (parseAmount), except 0 is legal here: "no refund".
    const amt = raw !== '' && Number(raw) === 0 ? 0 : parseAmount(raw);
    if (amt === null) {
      setCancelError(t('common.errors.amount'));
      return;
    }
    setCancelBusy(true);
    try {
      // Refund first: a REFUND_EXCEEDS_NET_PAID rejection leaves the card untouched.
      if (amt > 0) {
        await Refunds.record(cancelTarget.feeId, {
          amount: amt,
          refundedAt: new Date().toISOString().slice(0, 10),
        });
        // The refund is recorded; if the cancel below fails, a retry must not record it twice.
        setCancelAmount('0');
      }
      await Cards.cancel(cancelTarget.id);
      showToast({ text: t('cards.cancel.toast'), variant: 'success' });
      setCancelTarget(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setCancelError(apiErrorMessage(err));
    } finally {
      setCancelBusy(false);
    }
  };

  const cardState = (card: CardRow): 'cancelled' | 'expired' | 'exhausted' | 'active' => {
    if (card.cancelledAt) return 'cancelled';
    if (card.expiresAt && new Date(card.expiresAt) < new Date()) return 'expired';
    if (card.visitsRemaining <= 0) return 'exhausted';
    return 'active';
  };

  const columns: DataTableColumn<CardRowVM>[] = [
    {
      key: 'trainee',
      header: t('cards.fields.trainee'),
      cell: (row) => row.traineeName,
      sortValue: (row) => row.traineeName,
    },
    {
      key: 'scope',
      header: t('cards.fields.scope'),
      cell: (row) => row.scopeName,
      sortValue: (row) => row.scopeName,
    },
    {
      key: 'visits',
      header: t('cards.fields.visits'),
      cell: (row) => `${row.card.visitsUsed} / ${row.card.totalVisits}`,
      sortValue: (row) => row.card.visitsUsed,
    },
    {
      key: 'remaining',
      header: t('cards.fields.remaining'),
      cell: (row) => row.card.visitsRemaining,
      sortValue: (row) => row.card.visitsRemaining,
    },
    {
      key: 'price',
      header: t('cards.fields.price'),
      cell: (row) => formatMoney(Number(row.card.price), t('fees.currency')),
      sortValue: (row) => Number(row.card.price),
    },
    {
      key: 'expiresAt',
      header: t('cards.fields.expiresAt'),
      cell: (row) =>
        row.card.expiresAt ? row.card.expiresAt.slice(0, 10) : t('cards.neverExpires'),
      sortValue: (row) => row.card.expiresAt ?? '',
    },
    {
      key: 'state',
      header: t('cards.fields.state'),
      cell: (row) => {
        const state = cardState(row.card);
        return (
          <Badge variant={state === 'active' ? 'success' : 'secondary'}>
            {t(`cards.state.${state}`)}
          </Badge>
        );
      },
      sortValue: (row) => cardState(row.card),
    },
    ...(admin
      ? [
          {
            key: 'actions',
            header: '',
            cell: (row: CardRowVM) =>
              row.card.cancelledAt ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => openCancel(row.card)}
                >
                  {t('cards.cancel.action')}
                </Button>
              ),
          } satisfies DataTableColumn<CardRowVM>,
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('cards.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('cards.subtitle')}</p>
        </div>
        {admin && (
          <Button asChild>
            <Link href="/cards/new">
              <Plus className="h-4 w-4" />
              {t('cards.new')}
            </Link>
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DataTable
        columns={columns}
        rows={data}
        rowKey={(row) => row.card.id}
        emptyText={t('cards.empty')}
        pageInfo={pageInfo}
        onPageChange={setPage}
      />

      {/* TKT-0115 — cancel with an editable prorated refund. ConfirmDialog has no input
          slot, so this one is built from the same dialog primitives. */}
      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !cancelBusy) setCancelTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('cards.cancel.title')}</DialogTitle>
            <DialogDescription>{t('cards.cancel.hint')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-amount">
              {t('cards.cancel.amountLabel')} ({t('fees.currency')})
            </Label>
            <Input
              id="cancel-amount"
              type="number"
              step="0.01"
              min="0"
              value={cancelAmount}
              onChange={(e) => setCancelAmount(e.target.value)}
            />
          </div>
          {cancelError ? <p className="text-sm text-destructive">{cancelError}</p> : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={cancelBusy}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmCancel}
              disabled={cancelBusy}
            >
              {t('cards.cancel.action')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
