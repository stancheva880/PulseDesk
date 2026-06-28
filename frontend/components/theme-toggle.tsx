'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { setTheme, resolvedTheme } = useTheme();
  // Avoid hydration mismatch — Sun/Moon icon depends on the resolved theme,
  // which is only known after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('theme.switcher')}
          className="relative h-9 w-9"
        >
          <Sun
            className={`h-4 w-4 transition-all ${
              mounted && resolvedTheme === 'dark' ? 'scale-0 -rotate-90' : 'scale-100 rotate-0'
            }`}
          />
          <Moon
            className={`absolute h-4 w-4 transition-all ${
              mounted && resolvedTheme === 'dark' ? 'scale-100 rotate-0' : 'scale-0 rotate-90'
            }`}
          />
          <span className="sr-only">{t('theme.switcher')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="h-4 w-4" /> {t('theme.light')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="h-4 w-4" /> {t('theme.dark')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="h-4 w-4" /> {t('theme.system')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
