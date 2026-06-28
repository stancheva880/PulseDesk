'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { calculateAge } from '@/lib/age';
import { Trainees, type Trainee } from '@/lib/api-resources';

export default function TraineesListPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Trainee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Trainee | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    Trainees.list()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  };

  useEffect(reload, []);

  const onDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await Trainees.remove(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.errors.generic'));
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('trainees.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('trainees.subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/trainees/new">
            <Plus className="h-4 w-4" />
            {t('trainees.new')}
          </Link>
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('trainees.fields.lastName')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('trainees.fields.firstName')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('trainees.fields.age')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('trainees.fields.status')}</th>
              <th className="w-1 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t">
                  <td className="p-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-8" /></td>
                  <td className="p-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                  <td className="p-3"></td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-10 text-center text-sm text-muted-foreground">
                  {t('trainees.empty')}
                </td>
              </tr>
            ) : (
              rows.map((tr) => (
                <tr key={tr.id} className="border-t transition-colors hover:bg-muted/30">
                  <td className="p-3 font-medium">{tr.lastName}</td>
                  <td className="p-3">{tr.firstName}</td>
                  <td className="p-3 text-muted-foreground">
                    {calculateAge(new Date(tr.dateOfBirth))}
                  </td>
                  <td className="p-3">
                    <Badge variant={tr.isActive ? 'success' : 'secondary'}>
                      {tr.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/trainees/${tr.id}/edit`}>{t('common.edit')}</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setPendingDelete(tr)}
                    >
                      {t('common.delete')}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('trainees.deleteConfirm', {
          name: pendingDelete ? `${pendingDelete.firstName} ${pendingDelete.lastName}` : '',
        })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onDelete}
        busy={busy}
      />
    </div>
  );
}
