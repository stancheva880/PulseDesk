'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import {
  ClassSchedules,
  Classes,
  Locations,
  type ClassRow,
  type ClassSchedule,
  type GenerateSessionsResult,
  type Location,
} from '@/lib/api-resources';

export default function SchedulesListPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ClassSchedule[] | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClassSchedule | null>(null);
  const [delBusy, setDelBusy] = useState(false);

  // Generate-sessions form state.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [genResult, setGenResult] = useState<GenerateSessionsResult | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  const reload = () => {
    Promise.all([ClassSchedules.list(), Classes.list(), Locations.list()])
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

  const onDelete = async () => {
    if (!pendingDelete) return;
    setDelBusy(true);
    try {
      await ClassSchedules.remove(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.errors.generic'));
      setPendingDelete(null);
    } finally {
      setDelBusy(false);
    }
  };

  const onGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenError(null);
    setGenResult(null);
    if (from && to && to < from) {
      setGenError(t('schedules.errors.dateRange'));
      return;
    }
    setGenBusy(true);
    try {
      const result = await ClassSchedules.generateSessions({
        from,
        to,
        classId: classFilter || undefined,
      });
      setGenResult(result);
    } catch (err) {
      setGenError(err instanceof ApiError ? err.message : t('common.errors.generic'));
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('schedules.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('schedules.subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/schedules/new">
            <Plus className="h-4 w-4" />
            {t('schedules.new')}
          </Link>
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('schedules.generate')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('schedules.generateDescription')}</p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-4" onSubmit={onGenerate} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="from">{t('schedules.fields.from')}</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">{t('schedules.fields.to')}</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="classFilter">{t('schedules.fields.classFilter')}</Label>
              <select
                id="classFilter"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
              >
                <option value="">—</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={genBusy || !from || !to}>
                {genBusy ? t('common.saving') : t('schedules.generate')}
              </Button>
            </div>
          </form>
          {genResult ? (
            <p className="mt-3 text-sm text-success">
              {t('schedules.generated', { created: genResult.created, skipped: genResult.skipped })}
            </p>
          ) : null}
          {genError ? <p className="mt-3 text-sm text-destructive">{genError}</p> : null}
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('schedules.fields.class')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('schedules.fields.location')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('schedules.fields.dayOfWeek')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('schedules.fields.startTime')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('schedules.fields.endTime')}</th>
              <th className="w-1 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t">
                  <td className="p-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-20" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-12" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-12" /></td>
                  <td className="p-3"></td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-sm text-muted-foreground">
                  {t('schedules.empty')}
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.id} className="border-t transition-colors hover:bg-muted/30">
                  <td className="p-3 font-medium">{classNameById.get(s.classId) ?? '—'}</td>
                  <td className="p-3 text-muted-foreground">
                    {locationNameById.get(s.locationId) ?? '—'}
                  </td>
                  <td className="p-3">{t(`schedules.days.${s.dayOfWeek}`)}</td>
                  <td className="p-3 text-muted-foreground">{s.startTime}</td>
                  <td className="p-3 text-muted-foreground">{s.endTime}</td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/schedules/${s.id}/edit`}>{t('common.edit')}</Link>
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
        title={t('schedules.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onDelete}
        busy={delBusy}
      />
    </div>
  );
}
