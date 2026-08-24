'use client';

import { Menu } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavBrand, NavList } from '@/components/sidebar';
import { Dialog, DialogSheetContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

/**
 * Navigation for viewports below `md`, where the sidebar (`hidden … md:flex`) does not render.
 *
 * Mounts in the Topbar's existing left-hand `nav` slot. Destinations, their order and the role
 * filter all come from the sidebar's exported NAV_ITEMS via NavList — there is no second copy to
 * drift. Escape, backdrop dismissal, the focus trap and focus restore are Radix's.
 *
 * A dialog here is consistent with ADR-0003: that decision keeps *resource forms* out of dialogs,
 * and says nothing about navigation.
 */
export function MobileNav() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={t('nav.openMenu')}
        className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      >
        <Menu className="h-5 w-5" />
      </DialogTrigger>
      <DialogSheetContent closeLabel={t('nav.close')}>
        {/* Radix names the dialog from its title. A drawer's title is redundant on screen, so it
            stays in the accessibility tree only. */}
        <DialogTitle className="sr-only">{t('nav.menuTitle')}</DialogTitle>
        <NavBrand onNavigate={() => setOpen(false)} />
        <NavList onNavigate={() => setOpen(false)} />
      </DialogSheetContent>
    </Dialog>
  );
}
