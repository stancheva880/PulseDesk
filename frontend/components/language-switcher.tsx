'use client';

import { useTranslation } from 'react-i18next';
import { setLocale, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  return (
    <div
      className="inline-flex items-center rounded-md border bg-background p-0.5 text-xs"
      role="group"
      aria-label={t('language.switcher')}
    >
      {SUPPORTED_LOCALES.map((code) => {
        const active = i18n.resolvedLanguage === code;
        return (
          <button
            key={code}
            type="button"
            onClick={() => {
              void setLocale(code as Locale);
            }}
            aria-pressed={active}
            className={cn(
              'rounded px-2 py-1 font-medium uppercase tracking-wider transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}
