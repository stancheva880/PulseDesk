'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { isManager } from '@/lib/auth-storage';
import { Classes, type ClassRow } from '@/lib/api-resources';
import { useCrudList } from '@/lib/use-crud-list';

export default function ClassesListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);
  const { rows, setPage, pageInfo, error, pendingDelete, setPendingDelete, busy, onDelete } =
    useCrudList(Classes);

  const formatPrice = (cls: ClassRow): string => {
    if (cls.billingMode === 'PER_MONTH' && cls.monthlyAmount != null) {
      return `${cls.monthlyAmount} / ${t('classes.priceUnit.month')}`;
    }
    if (cls.billingMode === 'PER_SESSION' && cls.sessionPrice != null) {
      return `${cls.sessionPrice} / ${t('classes.priceUnit.session')}`;
    }
    return '—';
  };

  const columns: DataTableColumn<ClassRow>[] = [
    {
      key: 'name',
      header: t('classes.fields.name'),
      cell: (cls) => cls.name,
      cellClassName: 'font-medium',
      skeleton: 'h-4 w-32',
    },
    {
      key: 'billingMode',
      header: t('classes.fields.billingMode'),
      cell: (cls) => t(`classes.billing.${cls.billingMode}`),
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-20',
    },
    {
      key: 'price',
      header: t('classes.fields.price'),
      cell: formatPrice,
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-16',
    },
    {
      key: 'status',
      header: t('classes.fields.status'),
      cell: (cls) => (
        <Badge variant={cls.isActive ? 'success' : 'secondary'}>
          {cls.isActive ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
      skeleton: 'h-5 w-16 rounded-full',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('classes.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('classes.subtitle')}</p>
        </div>
        {admin ? (
          <Button asChild>
            <Link href="/classes/new">
              <Plus className="h-4 w-4" />
              {t('classes.new')}
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
        rowKey={(cls) => cls.id}
        emptyText={t('classes.empty')}
        actions={(cls) =>
          admin ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/classes/${cls.id}/edit`}>{t('common.edit')}</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setPendingDelete(cls)}
              >
                {t('common.delete')}
              </Button>
            </>
          ) : null
        }
        pageInfo={pageInfo}
        onPageChange={setPage}
        confirm={{
          open: pendingDelete !== null,
          onOpenChange: (open) => {
            if (!open) setPendingDelete(null);
          },
          title: t('classes.deleteConfirm', { name: pendingDelete?.name ?? '' }),
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          onConfirm: onDelete,
          busy,
        }}
      />
    </div>
  );
}
