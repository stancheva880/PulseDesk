// Same-tab avatar sync — the Topbar's AvatarMenu fetches its own copy of the avatar on mount
// (nothing in the JWT carries it), so when the profile page saves a new one, this is how that
// menu's copy is told without a full reload. No localStorage: the value is a data: URI up to a
// couple hundred KB, and this is a live-update channel, not a cache — see tenant-context.ts for
// the sibling pattern this mirrors (that one does persist, because the tenant choice must
// survive a reload; the avatar is re-fetched every mount instead).
const EVENT_NAME = 'pulsedesk:avatar-changed';

export function broadcastAvatarChanged(avatarUrl: string | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { avatarUrl } }));
}

export function subscribeAvatarChanged(handler: (avatarUrl: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ avatarUrl: string | null }>).detail;
    handler(detail?.avatarUrl ?? null);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
