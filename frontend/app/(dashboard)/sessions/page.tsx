'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isManager } from '@/lib/auth-storage';
import { formatDateTime } from '@/lib/utils';
import {
  Classes,
  Locations,
  Sessions,
  type ClassRow,
  type Location,
  type SessionRow,
  listAll,
} from '@/lib/api-resources';
import { useCrudList } from '@/lib/use-crud-list';
import { apiErrorMessage } from '@/lib/api';

export default function SessionsListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);
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
  } = useCrudList(Sessions);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    Promise.all([listAll(Classes.list), listAll(Locations.list)])
      .then(([c, l]) => {
        setClasses(c);
        setLocations(l);
      })
      .catch((e: unknown) => setError(apiErrorMessage(e)));
  }, [setError]);

  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const locationNameById = useMemo(
    () => new Map(locations.map((l) => [l.id, l.name])),
    [locations],
  );

  const statusVariant = (status: string): 'success' | 'secondary' | 'destructive' => {
    if (status === 'COMPLETED') return 'success';
    if (status === 'CANCELLED') return 'destructive';
    return 'secondary';
  };

  const columns: DataTableColumn<SessionRow>[] = [
    {
      key: 'startsAt',
      header: t('sessions.fields.startsAt'),
      cell: (s) => formatDateTime(s.startsAt),
      skeleton: 'h-4 w-40',
    },
    {
      key: 'class',
      header: t('sessions.fields.class'),
      cell: (s) => classNameById.get(s.classId) ?? '—',
      skeleton: 'h-4 w-32',
    },
    {
      key: 'location',
      header: t('sessions.fields.location'),
      cell: (s) => locationNameById.get(s.locationId) ?? '—',
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-24',
    },
    {
      key: 'status',
      header: t('sessions.fields.status'),
      cell: (s) => (
        <Badge variant={statusVariant(s.status)}>{t(`sessions.status.${s.status}`)}</Badge>
      ),
      skeleton: 'h-5 w-20 rounded-full',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('sessions.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('sessions.subtitle')}</p>
        </div>
        {admin ? (
          <Button asChild>
            <Link href="/sessions/new">
              <Plus className="h-4 w-4" />
              {t('sessions.new')}
            </Link>
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        emptyText={t('sessions.empty')}
        actions={(s) => (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/sessions/${s.id}/attendance`}>{t('sessions.markAttendance')}</Link>
            </Button>
            {admin ? (
              <>
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
              </>
            ) : null}
          </>
        )}
        pageInfo={pageInfo}
        onPageChange={setPage}
        confirm={{
          open: pendingDelete !== null,
          onOpenChange: (open) => {
            if (!open) setPendingDelete(null);
          },
          title: t('sessions.deleteConfirm'),
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          onConfirm: onDelete,
          busy,
        }}
      />
    </div>
  );
}
