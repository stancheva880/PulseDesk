'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

const ORDER = ['light', 'dark', 'system'] as const;
type Mode = (typeof ORDER)[number];

const ICONS: Record<Mode, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

// Single button cycling light → dark → system (PRD-0004 decision: cycle over menu —
// zero header-width change). aria-label names the active mode.
export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  // Avoid hydration mismatch — the stored theme is only known after mount.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- next-themes mount gate; runs once
  useEffect(() => setMounted(true), []);

  const mode: Mode =
    mounted && ORDER.includes(theme as Mode) ? (theme as Mode) : 'system';
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
  const Icon = ICONS[mode];

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${t('theme.switcher')} — ${t(`theme.${mode}`)}`}
      className="h-9 w-9"
      onClick={() => setTheme(next)}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
