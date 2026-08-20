'use client';

import { useTranslation } from 'react-i18next';
import { SetPasswordForm } from '@/components/set-password-form';

export default function AcceptInvitePage() {
  const { t } = useTranslation();

  return (
    <SetPasswordForm
      title={t('acceptInvite.title')}
      description={t('acceptInvite.description')}
      submitLabel={t('acceptInvite.submit')}
      invalidLinkMessage={t('acceptInvite.errors.invalidLink')}
    />
  );
}
