'use client';

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface TablePaginationProps {
  info: PageInfo | null;
  onPageChange: (page: number) => void;
}

// Prev/next pager rendered under list tables. Hidden while loading or when
// everything fits on one page.
export function TablePagination({ info, onPageChange }: TablePaginationProps) {
  const { t } = useTranslation();
  if (!info || info.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">
        {t('common.pagination.summary', {
          page: info.page,
          totalPages: info.totalPages,
          total: info.total,
        })}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={info.page <= 1}
          onClick={() => onPageChange(info.page - 1)}
        >
          {t('common.pagination.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={info.page >= info.totalPages}
          onClick={() => onPageChange(info.page + 1)}
        >
          {t('common.pagination.next')}
        </Button>
      </div>
    </div>
  );
}
