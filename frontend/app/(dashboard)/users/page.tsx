'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { Users, type UserRow } from '@/lib/api-resources';

export default function UsersListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    Users.list()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  };

  useEffect(reload, []);

  const onDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await Users.remove(pendingDelete.id);
      setPendingDelete(null);
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.errors.generic'));
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = user?.role === 'ADMIN';

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

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('users.fields.email', 'Email')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('users.fields.name', 'Name')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('users.fields.role', 'Role')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('users.fields.locations', 'Locations')}</th>
              <th className="p-3 text-left font-medium text-muted-foreground">{t('users.fields.status', 'Status')}</th>
              <th className="w-1 p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-t">
                  <td className="p-3"><Skeleton className="h-4 w-40" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-32" /></td>
                  <td className="p-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                  <td className="p-3"><Skeleton className="h-4 w-24" /></td>
                  <td className="p-3"><Skeleton className="h-5 w-16 rounded-full" /></td>
                  <td className="p-3"></td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-sm text-muted-foreground">
                  {t('users.empty', 'No users yet.')}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                // Admin policy: hide DELETE for SUPER_ADMIN rows so the action surface
                // matches the backend's enforcement.
                const canDelete = !(isAdmin && row.role === 'SUPER_ADMIN');
                const fullName =
                  [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || '—';
                return (
                  <tr key={row.id} className="border-t transition-colors hover:bg-muted/30">
                    <td className="p-3 font-medium">{row.email}</td>
                    <td className="p-3 text-muted-foreground">{fullName}</td>
                    <td className="p-3">
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {row.role}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.locations.map((l) => l.name).join(', ') || '—'}
                    </td>
                    <td className="p-3">
                      <Badge variant={row.isActive ? 'success' : 'secondary'}>
                        {row.isActive ? t('common.active') : t('common.inactive')}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap p-3 text-right">
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
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t('users.deleteConfirm', 'Delete user {{email}}?', { email: pendingDelete?.email ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={onDelete}
        busy={busy}
      />
    </div>
  );
}
