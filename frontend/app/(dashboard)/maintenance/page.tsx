'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { showToast } from '@/components/toast';
import { apiErrorMessage } from '@/lib/api';
import { Waitlist } from '@/lib/api-resources';

/**
 * TKT-0122: platform maintenance, SUPER_ADMIN-only. The nav item is role-gated
 * (sidebar.tsx NAV_ITEMS) and layout.tsx DENY_RULES bounces anyone else off the route; the
 * endpoint is @Roles(SUPER_ADMIN) regardless, so the API is the real gate.
 *
 * No confirm dialog on the sweep: it only removes queue entries the customer already cannot
 * see and that can never be promoted. Add one if that judgement changes.
 */
export default function MaintenancePage() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSweep = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await Waitlist.sweep();
      showToast({
        text: t('maintenance.waitlistSweep.done', { deleted: result.deleted }),
        variant: 'success',
      });
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('maintenance.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('maintenance.subtitle')}</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('maintenance.waitlistSweep.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t('maintenance.waitlistSweep.description')}
          </p>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={onSweep} disabled={busy}>
            {busy ? t('common.saving') : t('maintenance.waitlistSweep.run')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
