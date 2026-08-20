'use client';

import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SelectTenantPanelProps {
  /**
   * The club list could not be loaded. A different message, because "pick a club" is not
   * actionable when we do not know which clubs exist — and a failed request must never read
   * as a club-less system.
   */
  failed?: boolean;
}

// Rendered in place of page content when a SUPER_ADMIN has no active tenant. Copy only:
// the control it names is the TenantSelector in the Topbar, which stays on screen because
// this replaces <main>'s children, not the shell.
export function SelectTenantPanel({ failed = false }: SelectTenantPanelProps) {
  const { t } = useTranslation();

  // Four plain literals rather than one built key: i18n-keys.test.ts resolves only
  // single-quoted literal keys, so a template string would opt these out of that guard.
  return (
    <Card
      data-testid={failed ? 'clubs-failed-panel' : 'select-tenant-panel'}
      className="mx-auto max-w-md"
    >
      <CardHeader>
        <CardTitle className="text-xl">
          {failed ? t('tenants.loadFailed.title') : t('tenants.prompt.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {failed ? t('tenants.loadFailed.body') : t('tenants.prompt.body')}
        </p>
      </CardContent>
    </Card>
  );
}
