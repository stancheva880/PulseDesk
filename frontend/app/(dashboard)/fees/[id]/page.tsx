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
import { ApiError } from '@/lib/api';
import { isManager } from '@/lib/permissions';
import {
  Fees,
  Payments,
  type FeeDetail,
  type Payment,
} from '@/lib/api-resources';
import { cn } from '@/lib/utils';

export default function FeeDetailPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [fee, setFee] = useState<FeeDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  // Delete-payment confirm
  const [pendingPaymentDelete, setPendingPaymentDelete] = useState<Payment | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  const reload = () => {
    Fees.get(id)
      .then((f) => {
        setFee(f);
        setEditAmount(String(Number(f.amount)));
        setEditNotes(f.notes ?? '');
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'load failed'));
  };

  useEffect(reload, [id]);

  const onSaveFee = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    const amt = Number(editAmount);
    if (!Number.isFinite(amt) || amt < 0) {
      setEditError(t('fees.errors.amount'));
      return;
    }
    setEditBusy(true);
    try {
      await Fees.update(id, { amount: amt, notes: editNotes || undefined });
      reload();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t('common.errors.generic'));
    } finally {
      setEditBusy(false);
    }
  };

  const onAddPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayError(null);
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setPayError(t('fees.errors.amount'));
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
      reload();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : t('common.errors.generic'));
    } finally {
      setPayBusy(false);
    }
  };

  const onDeletePayment = async () => {
    if (!pendingPaymentDelete) return;
    setDelBusy(true);
    try {
      await Payments.remove(id, pendingPaymentDelete.id);
      setPendingPaymentDelete(null);
      reload();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('common.errors.generic'));
      setPendingPaymentDelete(null);
    } finally {
      setDelBusy(false);
    }
  };

  const totalPaid =
    fee?.payments.reduce((s, p) => s + Number(p.amount), 0) ?? 0;
  const outstanding = fee ? Math.max(0, Number(fee.amount) - totalPaid) : 0;

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
                {fee.trainee.firstName} {fee.trainee.lastName} · {fee.class.name}
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
                    disabled={!admin}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('fees.fields.outstanding')}</Label>
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {outstanding.toFixed(2)} {t('fees.currency')}
                  </p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="notes">{t('fees.fields.notes')}</Label>
                  <Textarea
                    id="notes"
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    disabled={!admin}
                  />
                </div>
                {editError ? (
                  <p className="text-sm text-destructive sm:col-span-2">{editError}</p>
                ) : null}
                {admin ? (
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={editBusy}>
                      {editBusy ? t('common.saving') : t('common.save')}
                    </Button>
                  </div>
                ) : null}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('payments.ledger')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {fee.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('payments.empty')}</p>
              ) : (
                <div className="rounded-md border">
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
                          <td className="p-3">
                            {new Date(p.paidAt).toISOString().slice(0, 10)}
                          </td>
                          <td className="p-3 font-medium">
                            {Number(p.amount).toFixed(2)} {t('fees.currency')}
                          </td>
                          <td className="p-3 text-muted-foreground">{p.method ?? '—'}</td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {p.recordedByEmailSnapshot ?? '—'}
                          </td>
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

              {admin ? (
              <div>
                <h3 className="mb-2 text-sm font-medium">{t('payments.addTitle')}</h3>
                <form className="grid gap-3 sm:grid-cols-2" onSubmit={onAddPayment} noValidate>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-amount">
                      {t('payments.fields.amount')} ({t('fees.currency')})
                    </Label>
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
    </div>
  );
}
