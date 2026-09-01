'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DebouncedSearchInput } from '@/components/ui/debounced-search-input';
import { isManager } from '@/lib/auth-storage';
import { Classes, type ClassRow } from '@/lib/api-resources';
import { useCrudList } from '@/lib/use-crud-list';

function ClassesList({ initialActiveOnly }: { initialActiveOnly: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);
  // TKT-0096: the dashboard's active-classes tile links here with ?isActive=true. The DTO
  // already supports the parameter — the dashboard count uses it.
  const [activeOnly, setActiveOnly] = useState(initialActiveOnly);
  // TKT-0093: server-side search via the DTO's existing `search` parameter; composes with
  // isActive in the same params object, so one request carries both.
  const [query, setQuery] = useState('');
  const { rows, setPage, pageInfo, error, pendingDelete, setPendingDelete, busy, onDelete } =
    useCrudList(Classes, {
      params: { isActive: activeOnly || undefined, search: query || undefined },
      deps: [activeOnly, query],
      deletedName: (cls) => cls.name,
    });

  const formatPrice = (cls: ClassRow): string => {
    if (cls.billingMode === 'PER_MONTH' && cls.monthlyAmount != null) {
      return `${cls.monthlyAmount} / ${t('classes.priceUnit.month')}`;
    }
    if (cls.billingMode === 'PER_SESSION' && cls.sessionPrice != null) {
      return `${cls.sessionPrice} / ${t('classes.priceUnit.session')}`;
    }
    if (cls.billingMode === 'PER_COURSE' && cls.coursePrice != null) {
      return `${cls.coursePrice} / ${t('classes.priceUnit.course')}`;
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
      // Always shown, not just on open — so a class with no trainer set is visible at a glance.
      key: 'trainers',
      header: t('classes.fields.trainers'),
      cell: (cls) =>
        cls.trainers && cls.trainers.length > 0
          ? cls.trainers.map((tr) => `${tr.firstName ?? ''} ${tr.lastName ?? ''}`.trim() || tr.email).join(', ')
          : '—',
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-24',
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

      <div className="sm:max-w-xs">
        <DebouncedSearchInput
          value={query}
          onApply={(q) => {
            setQuery(q);
            setPage(1); // a search from page 3 must not request page 3 of the filtered set
          }}
          placeholder={t('classes.search')}
        />
      </div>

      {activeOnly ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t('classes.filters.activeOnly')}</span>
          <Button variant="ghost" size="sm" onClick={() => setActiveOnly(false)}>
            {t('common.clear')}
          </Button>
        </div>
      ) : null}

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
        rowHref={(cls) => `/classes/${cls.id}/edit`}
        actions={(cls) =>
          admin ? (
            <>
              {/* TKT-0091: contextual create — each child form opens with this class chosen. */}
              <Button asChild variant="ghost" size="sm">
                <Link href={`/sessions/new?classId=${cls.id}`}>{t('sessions.new')}</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/schedules/new?classId=${cls.id}`}>{t('schedules.new')}</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/fees/new?classId=${cls.id}`}>{t('fees.new')}</Link>
              </Button>
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

// Reads ?isActive=true — the seam the dashboard tile links through (TKT-0096). Isolated +
// Suspense-wrapped so useSearchParams() doesn't force the whole page out of static
// prerendering (Next.js CSR-bailout requirement). Only the literal the tile sends filters;
// anything else degrades to the unfiltered list.
function ClassesListFromParams() {
  const params = useSearchParams();
  return <ClassesList initialActiveOnly={params.get('isActive') === 'true'} />;
}

export default function ClassesListPage() {
  return (
    <Suspense fallback={null}>
      <ClassesListFromParams />
    </Suspense>
  );
}
