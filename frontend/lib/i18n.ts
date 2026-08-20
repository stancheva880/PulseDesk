import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import bgCommon from '@/locales/bg/common.json';

export const SUPPORTED_LOCALES = ['bg', 'en'] as const;
const DEFAULT_LOCALE = 'bg';
export type Locale = (typeof SUPPORTED_LOCALES)[number];
const STORAGE_KEY = 'pulsedesk.locale';
const NS = 'common';

let initialized = false;
const loadedBundles = new Set<Locale>([DEFAULT_LOCALE]);

function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage?.getItem(STORAGE_KEY) as Locale | null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: Locale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore — private mode, etc. */
  }
}

async function loadLocaleBundle(locale: Locale): Promise<void> {
  if (loadedBundles.has(locale)) return;
  if (locale === 'en') {
    const mod = await import('@/locales/en/common.json');
    i18n.addResourceBundle('en', NS, mod.default ?? mod, true, true);
    loadedBundles.add('en');
  }
}

export function initI18n(): typeof i18n {
  if (initialized) return i18n;
  const initialLocale = readStoredLocale() ?? DEFAULT_LOCALE;

  void i18n.use(initReactI18next).init({
    resources: {
      bg: { common: bgCommon },
    },
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    defaultNS: NS,
    ns: [NS],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  initialized = true;

  if (initialLocale !== DEFAULT_LOCALE) {
    void loadLocaleBundle(initialLocale).then(() => i18n.changeLanguage(initialLocale));
  }

  return i18n;
}

export async function setLocale(locale: Locale): Promise<void> {
  await loadLocaleBundle(locale);
  await i18n.changeLanguage(locale);
  writeStoredLocale(locale);
}
