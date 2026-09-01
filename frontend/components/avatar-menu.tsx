'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { subscribeAvatarChanged } from '@/lib/avatar-context';
import { Users } from '@/lib/api-resources';
import { cn } from '@/lib/utils';

/**
 * Replaces the standalone Profile + Logout buttons that used to sit in the Topbar: one avatar
 * button (photo, or initials when there is none) that opens a small menu with both actions.
 *
 * No prop carries the avatar — nothing in the JWT does either — so this fetches its own copy on
 * mount and listens for lib/avatar-context.ts's same-tab broadcast, which the profile page fires
 * right after a successful upload, so this Topbar instance (mounted alongside it on /profile)
 * updates without a reload.
 */
export function AvatarMenu() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Users.getOwnProfile()
      .then((p) => {
        if (!cancelled) setAvatarUrl(p.avatarUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => subscribeAvatarChanged(setAvatarUrl), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const initial = (user.email[0] ?? '?').toUpperCase();

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('nav.profile')}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border bg-muted text-sm font-medium text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable remote image
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden>{initial}</span>
        )}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(
              'block rounded-sm px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {t('nav.editProfile')}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout().then(() => router.replace('/login'));
            }}
            className="block w-full rounded-sm px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            {t('nav.logout')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
