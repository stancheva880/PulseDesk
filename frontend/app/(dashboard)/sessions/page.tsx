'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import {
  Classes,
  Locations,
  Sessions,
  type ClassRow,
  type Location,
  type SessionRow,
} from '@/lib/api-resources';

export default function SessionsListPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SessionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    Promise.all([Sessions.list(), Classes.list(), Locations.list()])
      .then(([s, c, l]) => {
        setRows(s);
        setClasses(c);
        setLocations(l);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  };

  useEffect(reload, []);

  const classNameById = useMemo(
    () => new Map(classes.map((c) => [c.id, c.name])),
    [classes],
  );
  const locationNameById = useMemo(
    () => new Map(locations.map((l) => [l.id, l.name])),
    [locations],
  );

  const formatTime = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const onDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await Sessions.remove(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.errors.generic'));
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const statusVariant = (status: string): 'success' | 'secondary' | 'destructive' => {
    if (status === 'COMPLETED') return 'success';
    if (status === 'CANCELLED') return 'destructive';
    return 'secondary';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('sessions.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('sessions.subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/sessions/new">
            <Plus className="h-4 w-4" />
            {t('sessions.new')}
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
              <th className="p-3 text-left font-medium text-muted-foreground">{t('sessions.fields.startsAt')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('sessions.fields.class')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('sessions.fields.location')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('sessions.fields.status')}</th>
              <th className="w-1 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t">
                  <td className="p-3"><Skeleton className="h-4 w-40" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="p-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                  <td className="p-3"></td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-10 text-center text-sm text-muted-foreground">
                  {t('sessions.empty')}
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id} className="border-t transition-colors hover:bg-muted/30">
                  <td className="p-3">{formatTime(s.startsAt)}</td>
                  <td className="p-3">{classNameById.get(s.classId) ?? '—'}</td>
                  <td className="p-3 text-muted-foreground">
                    {locationNameById.get(s.locationId) ?? '—'}
                  </td>
                  <td className="p-3">
                    <Badge variant={statusVariant(s.status)}>{t(`sessions.status.${s.status}`)}</Badge>
                  </td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/sessions/${s.id}/attendance`}>
                        {t('sessions.markAttendance')}
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm" className="ml-1">
                      <Link href={`/sessions/${s.id}/edit`}>{t('common.edit')}</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setPendingDelete(s)}
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
        title={t('sessions.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onDelete}
        busy={busy}
      />
    </div>
  );
}
