'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { showToast } from '@/components/toast';
import { apiErrorMessage } from '@/lib/api';
import {
  ClassSchedules,
  Classes,
  Locations,
  type ClassRow,
  type ClassSchedule,
  type Location,
  listAll,
} from '@/lib/api-resources';
import { useCrudList } from '@/lib/use-crud-list';
import { NativeSelect } from '@/components/ui/native-select';

export default function SchedulesListPage() {
  const { t } = useTranslation();
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  // Declared before the hook call so the deletedName closure below never reads ahead of a
  // declaration — the React Compiler refuses to memoize that shape.
  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const locationNameById = useMemo(
    () => new Map(locations.map((l) => [l.id, l.name])),
    [locations],
  );
  const {
    rows,
    setPage,
    pageInfo,
    error,
    setError,
    pendingDelete,
    setPendingDelete,
    busy,
    onDelete,
  } = useCrudList(ClassSchedules, {
    deletedName: (s) =>
      `${classNameById.get(s.classId) ?? ''} ${t(`schedules.days.${s.dayOfWeek}`)} ${s.startTime}`.trim(),
  });

  // Generate-sessions form state.
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const [genBusy, setGenBusy] = useState(false);

  useEffect(() => {
    Promise.all([listAll(Classes.list), listAll(Locations.list)])
      .then(([c, l]) => {
        setClasses(c);
        setLocations(l);
      })
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  }, [setError]);

  const onGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenError(null);
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
      showToast({ text: t('schedules.generated', { created: result.created, skipped: result.skipped }), variant: 'success' });
    } catch (err) {
      setGenError(apiErrorMessage(err));
    } finally {
      setGenBusy(false);
    }
  };

  const columns: DataTableColumn<ClassSchedule>[] = [
    {
      key: 'class',
      header: t('schedules.fields.class'),
      cell: (s) => classNameById.get(s.classId) ?? '—',
      cellClassName: 'font-medium',
      skeleton: 'h-4 w-32',
    },
    {
      key: 'location',
      header: t('schedules.fields.location'),
      cell: (s) => locationNameById.get(s.locationId) ?? '—',
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-24',
    },
    {
      key: 'dayOfWeek',
      header: t('schedules.fields.dayOfWeek'),
      cell: (s) => t(`schedules.days.${s.dayOfWeek}`),
      skeleton: 'h-4 w-20',
    },
    {
      key: 'startTime',
      header: t('schedules.fields.startTime'),
      cell: (s) => s.startTime,
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-12',
    },
    {
      key: 'endTime',
      header: t('schedules.fields.endTime'),
      cell: (s) => s.endTime,
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-12',
    },
  ];

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
              <NativeSelect
                id="classFilter"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
              >
                <option value="">—</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={genBusy || !from || !to}>
                {genBusy ? t('common.saving') : t('schedules.generate')}
              </Button>
            </div>
          </form>
          {genError ? <p className="mt-3 text-sm text-destructive">{genError}</p> : null}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        emptyText={t('schedules.empty')}
        rowHref={(s) => `/schedules/${s.id}/edit`}
        actions={(s) => (
          <>
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
          </>
        )}
        pageInfo={pageInfo}
        onPageChange={setPage}
        confirm={{
          open: pendingDelete !== null,
          onOpenChange: (open) => {
            if (!open) setPendingDelete(null);
          },
          title: t('schedules.deleteConfirm'),
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          onConfirm: onDelete,
          busy,
        }}
      />
    </div>
  );
}
