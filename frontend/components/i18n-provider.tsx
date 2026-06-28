'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { initI18n } from '@/lib/i18n';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [i18nInstance] = useState(() => initI18n());
  const [ready, setReady] = useState(i18nInstance.isInitialized);

  useEffect(() => {
    if (!i18nInstance.isInitialized) {
      i18nInstance.on('initialized', () => setReady(true));
    }
  }, [i18nInstance]);

  if (!ready) return null;
  return <I18nextProvider i18n={i18nInstance}>{children}</I18nextProvider>;
}
