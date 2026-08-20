'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Users, type UserRow } from '@/lib/api-resources';
import { useCrudList } from '@/lib/use-crud-list';

// TKT-0060: the three server-derived account states. A pending row and an inactive row must not
// look alike — an admin reads this column to decide whether to re-send an invite.
const STATUS_BADGE: Record<UserRow['status'], { variant: BadgeProps['variant']; key: string }> = {
  PENDING: { variant: 'warning', key: 'users.status.pending' },
  ACTIVE: { variant: 'success', key: 'common.active' },
  INACTIVE: { variant: 'secondary', key: 'common.inactive' },
};

// Reads ?attached=1 (set by the new-user form when an existing account was attached).
// Isolated + Suspense-wrapped so useSearchParams() doesn't force the page out of
// static prerendering (Next.js CSR-bailout requirement).
function AttachedBanner() {
  const { t } = useTranslation();
  const params = useSearchParams();
  if (params.get('attached') !== '1') return null;
  return (
    <p
      role="status"
      className="rounded-lg border border-success/40 bg-success/10 px-3.5 py-2.5 text-sm text-success"
    >
      {t(
        'users.attachedExisting',
        'Existing account added to your club — their password is unchanged.',
      )}
    </p>
  );
}

export default function UsersListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { rows, setPage, pageInfo, error, pendingDelete, setPendingDelete, busy, onDelete } =
    useCrudList(Users);

  const isAdmin = user?.role === 'ADMIN';
  // inviteEmailSent: false comes back on a 200, so the outcome has to be reported either way.
  const [resendNotice, setResendNotice] = useState<string | null>(null);

  const onResend = async (row: UserRow) => {
    setResendNotice(null);
    try {
      const { inviteEmailSent } = await Users.resendInvite(row.id);
      setResendNotice(
        t(inviteEmailSent ? 'users.resendSent' : 'users.resendFailed', { email: row.email }),
      );
    } catch {
      setResendNotice(t('users.resendFailed', { email: row.email }));
    }
  };

  const columns: DataTableColumn<UserRow>[] = [
    {
      key: 'email',
      header: t('users.fields.email', 'Email'),
      cell: (row) => row.email,
      cellClassName: 'font-medium',
      skeleton: 'h-4 w-40',
    },
    {
      key: 'name',
      header: t('users.fields.name', 'Name'),
      cell: (row) => [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || '—',
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-32',
    },
    {
      key: 'phone',
      header: t('users.fields.phone', 'Phone'),
      cell: (row) => row.phone || '—',
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-24',
    },
    {
      key: 'role',
      header: t('users.fields.role', 'Role'),
      cell: (row) => (
        <Badge variant="outline" className="text-[10px]">
          {t(`login.pickTenant.roles.${row.role}`, row.role)}
        </Badge>
      ),
      skeleton: 'h-5 w-16 rounded-full',
    },
    {
      key: 'locations',
      header: t('users.fields.locations', 'Locations'),
      cell: (row) => row.locations.map((l) => l.name).join(', ') || '—',
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-24',
    },
    {
      key: 'status',
      header: t('users.fields.status', 'Status'),
      cell: (row) => {
        const badge = STATUS_BADGE[row.status];
        return <Badge variant={badge.variant}>{t(badge.key)}</Badge>;
      },
      skeleton: 'h-5 w-16 rounded-full',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('users.title', 'Users')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('users.subtitle', 'Manage members of the current tenant.')}
          </p>
        </div>
        <Button asChild>
          <Link href="/users/new">
            <Plus className="h-4 w-4" />
            {t('users.new', 'New user')}
          </Link>
        </Button>
      </div>

      <Suspense fallback={null}>
        <AttachedBanner />
      </Suspense>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {resendNotice ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground"
        >
          {resendNotice}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        emptyText={t('users.empty', 'No users yet.')}
        actions={(row) => {
          // Admin policy: hide DELETE for SUPER_ADMIN rows so the action surface
          // matches the backend's enforcement.
          const canDelete = !(isAdmin && row.role === 'SUPER_ADMIN');
          return (
            <>
              {row.status === 'PENDING' ? (
                <Button variant="ghost" size="sm" onClick={() => void onResend(row)}>
                  {t('users.resendInvite')}
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="sm">
                <Link href={`/users/${row.id}/edit`}>{t('common.edit')}</Link>
              </Button>
              {canDelete ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setPendingDelete(row)}
                >
                  {t('common.delete')}
                </Button>
              ) : null}
            </>
          );
        }}
        pageInfo={pageInfo}
        onPageChange={setPage}
        confirm={{
          open: pendingDelete !== null,
          onOpenChange: (open) => {
            if (!open) setPendingDelete(null);
          },
          // ADMIN deletion is per-membership removal (TKT-0004) — say so; SUPER_ADMIN
          // deletion is account-wide and keeps the delete wording.
          title: isAdmin
            ? t('users.removeConfirm.title', 'Remove {{email}} from your club?', {
                email: pendingDelete?.email ?? '',
              })
            : t('users.deleteConfirm', 'Delete user {{email}}?', {
                email: pendingDelete?.email ?? '',
              }),
          description: isAdmin
            ? t(
                'users.removeConfirm.description',
                'Their account and memberships in other clubs are unaffected.',
              )
            : undefined,
          confirmLabel: isAdmin
            ? t('users.removeConfirm.confirm', 'Remove from club')
            : t('common.delete'),
          cancelLabel: t('common.cancel'),
          onConfirm: onDelete,
          busy,
        }}
      />
    </div>
  );
}
