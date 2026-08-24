'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Locations, type Location } from '@/lib/api-resources';
import { useCrudList } from '@/lib/use-crud-list';

export default function LocationsListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Not isManager(): location writes are SUPER_ADMIN-only on the API, since the tenant's
  // location footprint is a system-administrator concern (locations.controller.ts:52,58,68).
  const canWrite = user?.role === 'SUPER_ADMIN';
  const { rows, setPage, pageInfo, error, pendingDelete, setPendingDelete, busy, onDelete } =
    useCrudList(Locations, { deletedName: (loc) => loc.name });

  const columns: DataTableColumn<Location>[] = [
    {
      key: 'name',
      header: t('locations.fields.name'),
      cell: (loc) => loc.name,
      cellClassName: 'font-medium',
      skeleton: 'h-4 w-32',
    },
    {
      key: 'address',
      header: t('locations.fields.address'),
      cell: (loc) => loc.address ?? '—',
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-48',
    },
    {
      key: 'status',
      header: t('locations.fields.status'),
      cell: (loc) => (
        <Badge variant={loc.isActive ? 'success' : 'secondary'}>
          {loc.isActive ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
      skeleton: 'h-5 w-16 rounded-full',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('locations.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('locations.subtitle')}</p>
        </div>
        {canWrite ? (
          <Button asChild>
            <Link href="/locations/new">
              <Plus className="h-4 w-4" />
              {t('locations.new')}
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
        rowKey={(loc) => loc.id}
        emptyText={t('locations.empty')}
        // Location edits are SUPER_ADMIN-only and the layout bounces everyone else off the
        // route (layout.tsx DENY_RULES) — an inert row is honest, a bounce is not (TKT-0088).
        rowHref={canWrite ? (loc) => `/locations/${loc.id}/edit` : undefined}
        actions={(loc) =>
          canWrite ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/locations/${loc.id}/edit`}>{t('common.edit')}</Link>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setPendingDelete(loc)}
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
          title: t('locations.deleteConfirm', { name: pendingDelete?.name ?? '' }),
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          onConfirm: onDelete,
          busy,
        }}
      />
    </div>
  );
}
