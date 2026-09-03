'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiErrorMessage } from '@/lib/api';
import { showToast } from '@/components/toast';
import { isManager } from '@/lib/auth-storage';
import {
  Fees,
  Payments,
  Refunds,
  type FeeDetail,
  type Payment,
  type Refund,
} from '@/lib/api-resources';
import { cn, formatMoney, parseAmount } from '@/lib/utils';

export default function FeeDetailPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);
  // TKT-0129: a trainer edits the amount/notes of a fee for a class they teach — the backend
  // scopes this the same way it scopes reads (fees.service.ts's classAccessScope). Payments
  // and refunds stay ADMIN/SUPER_ADMIN only below (unchanged, not part of this request).
  const canEditFee = admin || user?.role === 'EMPLOYEE';
  // TKT-0129: a trainer can also record a payment on a fee for a class they teach — the
  // backend scopes this the same way (PaymentsService.record via assertFeeAccessible).
  // Deleting a payment, and refunds entirely, stay ADMIN/SUPER_ADMIN only, below.
  const canRecordPayment = admin || user?.role === 'EMPLOYEE';
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [fee, setFee] = useState<FeeDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Which ledger card shows. Same tab-instead-of-stacking pattern as the fees list's three
  // generator forms — one at a time reads better than two full ledgers stacked, on desktop too.
  const [ledgerTab, setLedgerTab] = useState<'payments' | 'refunds'>('payments');

  // Edit-fee form
  const [editAmount, setEditAmount] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  // Add-payment form
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payMethod, setPayMethod] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  // Add-refund form (TKT-0105)
  const [refAmount, setRefAmount] = useState('');
  const [refDate, setRefDate] = useState('');
  const [refMethod, setRefMethod] = useState('');
  const [refNotes, setRefNotes] = useState('');
  const [refError, setRefError] = useState<string | null>(null);
  const [refBusy, setRefBusy] = useState(false);

  // Delete-payment confirm
  const [pendingPaymentDelete, setPendingPaymentDelete] = useState<Payment | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  // Delete-refund confirm
  const [pendingRefundDelete, setPendingRefundDelete] = useState<Refund | null>(null);
  const [refDelBusy, setRefDelBusy] = useState(false);

  const reload = () => {
    Fees.get(id)
      .then((f) => {
        setFee(f);
        setEditAmount(String(Number(f.amount)));
        setEditNotes(f.notes ?? '');
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  };

  useEffect(reload, [id]);

  const onSaveFee = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    // One rule for every money box in these screens (lib/utils.ts). This used to accept >= 0,
    // so clearing the field saved a zero fee.
    const amt = parseAmount(editAmount);
    if (amt === null) {
      setEditError(t('common.errors.amount'));
      return;
    }
    setEditBusy(true);
    try {
      await Fees.update(id, { amount: amt, notes: editNotes || undefined });
      // TKT-0092: this form never navigated, so the only feedback was a refetched number.
      showToast({ text: t('common.savedToast'), variant: 'success' });
      reload();
    } catch (err) {
      setEditError(apiErrorMessage(err));
    } finally {
      setEditBusy(false);
    }
  };

  const onAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayError(null);
    const amt = parseAmount(payAmount);
    if (amt === null) {
      setPayError(t('common.errors.amount'));
      return;
    }
    if (!payDate) {
      setPayError(t('common.errors.required'));
      return;
    }
    setPayBusy(true);
    try {
      await Payments.record(id, {
        amount: amt,
        paidAt: payDate,
        method: payMethod || undefined,
        notes: payNotes || undefined,
      });
      setPayAmount('');
      setPayDate('');
      setPayMethod('');
      setPayNotes('');
      // TKT-0092: cleared inputs and a refetched number are ambiguous, not a confirmation.
      showToast({ text: t('payments.recordedToast'), variant: 'success' });
      reload();
    } catch (err) {
      setPayError(apiErrorMessage(err));
    } finally {
      setPayBusy(false);
    }
  };

  const onAddRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    setRefError(null);
    const amt = parseAmount(refAmount);
    if (amt === null) {
      setRefError(t('common.errors.amount'));
      return;
    }
    if (!refDate) {
      setRefError(t('common.errors.required'));
      return;
    }
    setRefBusy(true);
    try {
      await Refunds.record(id, {
        amount: amt,
        refundedAt: refDate,
        method: refMethod || undefined,
        notes: refNotes || undefined,
      });
      setRefAmount('');
      setRefDate('');
      setRefMethod('');
      setRefNotes('');
      showToast({ text: t('refunds.recordedToast'), variant: 'success' });
      reload();
    } catch (err) {
      setRefError(apiErrorMessage(err));
    } finally {
      setRefBusy(false);
    }
  };

  const onDeleteRefund = async () => {
    if (!pendingRefundDelete) return;
    setRefDelBusy(true);
    try {
      await Refunds.remove(id, pendingRefundDelete.id);
      showToast({
        text: t('common.deletedToast', {
          name: formatMoney(pendingRefundDelete.amount, t('fees.currency')),
        }),
        variant: 'success',
      });
      setPendingRefundDelete(null);
      reload();
    } catch (err) {
      setLoadError(apiErrorMessage(err));
      setPendingRefundDelete(null);
    } finally {
      setRefDelBusy(false);
    }
  };

  const onDeletePayment = async () => {
    if (!pendingPaymentDelete) return;
    setDelBusy(true);
    try {
      await Payments.remove(id, pendingPaymentDelete.id);
      // TKT-0092: name what was removed; the refetch below stays as it was.
      showToast({
        text: t('common.deletedToast', {
          name: formatMoney(pendingPaymentDelete.amount, t('fees.currency')),
        }),
        variant: 'success',
      });
      setPendingPaymentDelete(null);
      reload();
    } catch (err) {
      setLoadError(apiErrorMessage(err));
      setPendingPaymentDelete(null);
    } finally {
      setDelBusy(false);
    }
  };

  const totalPaid =
    fee?.payments.reduce((s, p) => s + Number(p.amount), 0) ?? 0;
  // TKT-0105: what the club actually holds is net of refunds; outstanding follows it, so a
  // refunded slice reopens as collectable — the same rule the server's payment guard applies.
  const totalRefunded =
    fee?.refunds.reduce((s, r) => s + Number(r.amount), 0) ?? 0;
  const netPaid = totalPaid - totalRefunded;
  // The API refuses a total above the amount (TKT-0072), so the clamp guards a state the server no
  // longer produces — it only keeps a row seeded before that rule from rendering a negative balance.
  const outstanding = fee ? Math.max(0, Number(fee.amount) - netPaid) : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('fees.edit')}</h1>
        <Button type="button" variant="outline" onClick={() => router.push('/fees')}>
          {t('common.cancel')}
        </Button>
      </div>

      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      {!fee ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {fee.trainee.firstName} {fee.trainee.lastName} · {fee.class?.name ?? '—'}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {new Date(fee.periodStart).toISOString().slice(0, 10)} →{' '}
                {new Date(fee.periodEnd).toISOString().slice(0, 10)}
                <span
                  className={cn(
                    'ml-2 rounded px-2 py-0.5 text-xs',
                    fee.status === 'PAID' && 'bg-green-100 text-green-900',
                    fee.status === 'PARTIAL' && 'bg-amber-100 text-amber-900',
                    fee.status === 'UNPAID' && 'bg-muted text-muted-foreground',
                  )}
                >
                  {t(`fees.status.${fee.status}`)}
                </span>
              </p>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSaveFee} noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="amount">
                    {t('fees.fields.amount')} ({t('fees.currency')})
                  </Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    disabled={!canEditFee}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('fees.fields.outstanding')}</Label>
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {formatMoney(outstanding, t('fees.currency'))}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('fees.fields.netPaid')}</Label>
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {formatMoney(netPaid, t('fees.currency'))}
                  </p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="notes">{t('fees.fields.notes')}</Label>
                  <Textarea
                    id="notes"
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    disabled={!canEditFee}
                  />
                </div>
                {editError ? (
                  <p className="text-sm text-destructive sm:col-span-2">{editError}</p>
                ) : null}
                {canEditFee ? (
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={editBusy}>
                      {editBusy ? t('common.saving') : t('common.save')}
                    </Button>
                  </div>
                ) : null}
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={ledgerTab === 'payments' ? 'default' : 'outline'}
              onClick={() => setLedgerTab('payments')}
            >
              {t('payments.ledger')}
            </Button>
            <Button
              type="button"
              variant={ledgerTab === 'refunds' ? 'default' : 'outline'}
              onClick={() => setLedgerTab('refunds')}
            >
              {t('refunds.ledger')}
            </Button>
          </div>

          {ledgerTab === 'payments' ? (
          <Card>
            <CardContent className="space-y-4 pt-6">
              {fee.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('payments.empty')}</p>
              ) : (
                /* Same opt-in as the attendance roster and DataTable: the card layout lives once
                   in globals.css (TKT-0086) and is keyed off this class. */
                <div className="pd-card-table rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">{t('payments.fields.paidAt')}</th>
                        <th className="p-3 text-left font-medium">{t('payments.fields.amount')}</th>
                        <th className="p-3 text-left font-medium">{t('payments.fields.method')}</th>
                        <th className="p-3 text-left font-medium">
                          {t('payments.fields.recordedBy')}
                        </th>
                        <th className="w-1 p-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fee.payments.map((p) => (
                        <tr key={p.id} className="border-t">
                          <td data-label={t('payments.fields.paidAt')} className="p-3">
                            {new Date(p.paidAt).toISOString().slice(0, 10)}
                          </td>
                          <td
                            data-label={t('payments.fields.amount')}
                            className="p-3 font-medium"
                          >
                            {formatMoney(p.amount, t('fees.currency'))}
                          </td>
                          <td
                            data-label={t('payments.fields.method')}
                            className="p-3 text-muted-foreground"
                          >
                            {p.method ?? '—'}
                          </td>
                          <td
                            data-label={t('payments.fields.recordedBy')}
                            className="p-3 text-xs text-muted-foreground"
                          >
                            {p.recordedByEmailSnapshot ?? '—'}
                          </td>
                          {/* No data-label: the actions cell is chrome, not a field. */}
                          <td className="p-3 text-right">
                            {admin ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => setPendingPaymentDelete(p)}
                              >
                                {t('common.delete')}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {canRecordPayment ? (
              <div>
                <h3 className="mb-2 text-sm font-medium">{t('payments.addTitle')}</h3>
                <form className="grid gap-3 sm:grid-cols-2" onSubmit={onAddPayment} noValidate>
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor="p-amount">
                        {t('payments.fields.amount')} ({t('fees.currency')})
                      </Label>
                      {outstanding > 0 ? (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          onClick={() => setPayAmount(String(outstanding))}
                        >
                          {t('payments.payRest')}
                        </button>
                      ) : null}
                    </div>
                    <Input
                      id="p-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-paidAt">{t('payments.fields.paidAt')}</Label>
                    <Input
                      id="p-paidAt"
                      type="date"
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-method">{t('payments.fields.method')}</Label>
                    <Input
                      id="p-method"
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      placeholder="cash / bank / card"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-notes">{t('payments.fields.notes')}</Label>
                    <Input
                      id="p-notes"
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                    />
                  </div>
                  {payError ? (
                    <p className="text-sm text-destructive sm:col-span-2">{payError}</p>
                  ) : null}
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={payBusy}>
                      {payBusy ? t('common.saving') : t('common.save')}
                    </Button>
                  </div>
                </form>
              </div>
              ) : null}
            </CardContent>
          </Card>
          ) : null}

          {/* TKT-0105 — money out: the refunds ledger mirrors the payments ledger. */}
          {ledgerTab === 'refunds' ? (
          <Card>
            <CardContent className="space-y-4 pt-6">
              {fee.refunds.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('refunds.empty')}</p>
              ) : (
                <div className="pd-card-table rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">
                          {t('refunds.fields.refundedAt')}
                        </th>
                        <th className="p-3 text-left font-medium">{t('refunds.fields.amount')}</th>
                        <th className="p-3 text-left font-medium">{t('refunds.fields.method')}</th>
                        <th className="p-3 text-left font-medium">
                          {t('refunds.fields.recordedBy')}
                        </th>
                        <th className="w-1 p-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {fee.refunds.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td data-label={t('refunds.fields.refundedAt')} className="p-3">
                            {new Date(r.refundedAt).toISOString().slice(0, 10)}
                          </td>
                          <td
                            data-label={t('refunds.fields.amount')}
                            className="p-3 font-medium"
                          >
                            {formatMoney(r.amount, t('fees.currency'))}
                          </td>
                          <td
                            data-label={t('refunds.fields.method')}
                            className="p-3 text-muted-foreground"
                          >
                            {r.method ?? '—'}
                          </td>
                          <td
                            data-label={t('refunds.fields.recordedBy')}
                            className="p-3 text-xs text-muted-foreground"
                          >
                            {r.recordedByEmailSnapshot ?? '—'}
                          </td>
                          {/* No data-label: the actions cell is chrome, not a field. */}
                          <td className="p-3 text-right">
                            {admin ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => setPendingRefundDelete(r)}
                              >
                                {t('common.delete')}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {admin ? (
              <div>
                <h3 className="mb-2 text-sm font-medium">{t('refunds.addTitle')}</h3>
                <form className="grid gap-3 sm:grid-cols-2" onSubmit={onAddRefund} noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor="r-amount">
                      {t('refunds.fields.amount')} ({t('fees.currency')})
                    </Label>
                    <Input
                      id="r-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={refAmount}
                      onChange={(e) => setRefAmount(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="r-refundedAt">{t('refunds.fields.refundedAt')}</Label>
                    <Input
                      id="r-refundedAt"
                      type="date"
                      value={refDate}
                      onChange={(e) => setRefDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="r-method">{t('refunds.fields.method')}</Label>
                    <Input
                      id="r-method"
                      value={refMethod}
                      onChange={(e) => setRefMethod(e.target.value)}
                      placeholder="cash / bank / card"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="r-notes">{t('refunds.fields.notes')}</Label>
                    <Input
                      id="r-notes"
                      value={refNotes}
                      onChange={(e) => setRefNotes(e.target.value)}
                    />
                  </div>
                  {refError ? (
                    <p className="text-sm text-destructive sm:col-span-2">{refError}</p>
                  ) : null}
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={refBusy}>
                      {refBusy ? t('common.saving') : t('common.save')}
                    </Button>
                  </div>
                </form>
              </div>
              ) : null}
            </CardContent>
          </Card>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={pendingPaymentDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPaymentDelete(null);
        }}
        title={t('payments.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onDeletePayment}
        busy={delBusy}
      />

      <ConfirmDialog
        open={pendingRefundDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRefundDelete(null);
        }}
        title={t('refunds.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onDeleteRefund}
        busy={refDelBusy}
      />
    </div>
  );
}
