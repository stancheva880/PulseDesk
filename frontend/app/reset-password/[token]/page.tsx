'use client';

import { useTranslation } from 'react-i18next';
import { SetPasswordForm } from '@/components/set-password-form';

export default function ResetPasswordPage() {
  const { t } = useTranslation();

  return (
    <SetPasswordForm
      title={t('resetPassword.title')}
      description={t('resetPassword.description')}
      submitLabel={t('resetPassword.submit')}
      invalidLinkMessage={t('resetPassword.errors.invalidLink')}
    />
  );
}
