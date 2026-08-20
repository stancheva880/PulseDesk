'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { calculateAge } from '@/lib/age';
import { isManager } from '@/lib/auth-storage';
import { Trainees, type Trainee } from '@/lib/api-resources';
import { useCrudList } from '@/lib/use-crud-list';

export default function TraineesListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);
  const { rows, setPage, pageInfo, error, pendingDelete, setPendingDelete, busy, onDelete } =
    useCrudList(Trainees);

  const columns: DataTableColumn<Trainee>[] = [
    {
      key: 'lastName',
      header: t('trainees.fields.lastName'),
      cell: (tr) => tr.lastName,
      cellClassName: 'font-medium',
      skeleton: 'h-4 w-24',
    },
    {
      key: 'firstName',
      header: t('trainees.fields.firstName'),
      cell: (tr) => tr.firstName,
      skeleton: 'h-4 w-24',
    },
    {
      key: 'age',
      header: t('trainees.fields.age'),
      cell: (tr) => calculateAge(new Date(tr.dateOfBirth)),
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-8',
    },
    {
      key: 'status',
      header: t('trainees.fields.status'),
      cell: (tr) => (
        <Badge variant={tr.isActive ? 'success' : 'secondary'}>
          {tr.isActive ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
      skeleton: 'h-5 w-16 rounded-full',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('trainees.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('trainees.subtitle')}</p>
        </div>
        {admin ? (
          <Button asChild>
            <Link href="/trainees/new">
              <Plus className="h-4 w-4" />
              {t('trainees.new')}
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
        rowKey={(tr) => tr.id}
        emptyText={t('trainees.empty')}
        actions={(tr) => (
          <>
            {/* Read-only detail — the only way a trainer reaches phone and guardian contacts. */}
            <Button asChild variant="ghost" size="sm">
              <Link href={`/trainees/${tr.id}`}>{t('common.view')}</Link>
            </Button>
            {admin ? (
              <>
                <Button asChild variant="ghost" size="sm" className="ml-1">
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
          title: t('trainees.deleteConfirm', {
            name: pendingDelete ? `${pendingDelete.firstName} ${pendingDelete.lastName}` : '',
          }),
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          onConfirm: onDelete,
          busy,
        }}
      />
    </div>
  );
}
