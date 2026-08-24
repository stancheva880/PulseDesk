'use client';

import { X } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * `info` is not decoration. Some outcomes are neither: a resent invite that returns 200 with
 * `inviteEmailSent: false` has succeeded as a call and failed as a delivery, and the page it
 * replaced reported that in a neutral box rather than a red one. Keeping a neutral variant means
 * moving a message into a toast does not silently re-classify how severe it is.
 */
export type ToastVariant = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  text: string;
  variant: ToastVariant;
}

/**
 * Confirmations for completed actions, rendered outside the page that raised them so a route change
 * cannot take them with it (PRD-0012, TKT-0089). Hand-rolled rather than a dependency, per ADR-0003.
 *
 * A module store rather than a React context, deliberately: `showToast` is then importable from any
 * call site without every test that renders a toast-capable page needing a provider it does not care
 * about, and without a missing provider silently swallowing messages in production. Only rendering
 * needs `<ToastViewport />`, which the root layout mounts once.
 *
 * For validation and field-level errors, see the inline error handling those forms own — a toast is
 * for something that finished, not for something that is wrong.
 */
/** Stable empty reference: `useSyncExternalStore` compares snapshots identity-wise. */
const EMPTY: Toast[] = [];

let toasts: Toast[] = EMPTY;
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

const getSnapshot = () => toasts;
const getServerSnapshot = () => EMPTY;

/** How long a toast stays up. Long enough to read a short sentence, short enough not to linger. */
const TOAST_TIMEOUT_MS = 5000;

export function showToast({ text, variant }: { text: string; variant: ToastVariant }): void {
  toasts = [...toasts, { id: nextId++, text, variant }];
  emit();
}

/**
 * TKT-0092: one hard navigation exists (club creation → `hardNavigate`), and a document
 * navigation discards this module store. The pending toast is persisted under one key and
 * drained by the next document's viewport on mount. A handoff for that single case, not a
 * persistence layer — keep it to one key and one shape.
 */
const PENDING_KEY = 'pulsedesk.pendingToast';

export function stashToast(toast: { text: string; variant: ToastVariant }): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(toast));
  } catch {
    // Storage denied (private mode) — the navigation still works, only the confirmation is lost.
  }
}

/** Drains the stashed toast, if any. Runs on viewport mount, after clearToasts. */
function drainStashedToast(): void {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw === null) return;
    sessionStorage.removeItem(PENDING_KEY);
    const parsed: unknown = JSON.parse(raw);
    const { text, variant } = parsed as { text?: unknown; variant?: unknown };
    if (typeof text !== 'string') return;
    showToast({
      text,
      variant: variant === 'error' || variant === 'info' ? variant : 'success',
    });
  } catch {
    // Malformed content or storage denied — surface nothing rather than break the mount.
  }
}

function dismissToast(id: number): void {
  const next = toasts.filter((toast) => toast.id !== id);
  toasts = next.length === 0 ? EMPTY : next;
  emit();
}

/** Drops anything raised while no viewport was mounted to show it. */
function clearToasts(): void {
  if (toasts === EMPTY) return;
  toasts = EMPTY;
  emit();
}

export function ToastViewport() {
  const { t } = useTranslation();
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // A message raised before anything was mounted to render it would otherwise surface against
  // whatever mounts next. Notifying through the store rather than calling setState directly keeps
  // this out of the cascading-render trap the lint rule guards.
  // The stash drain runs in the same effect, after the clear, so it cannot be swallowed by it —
  // a toast handed across a document navigation is the one kind that must survive this mount.
  useEffect(() => {
    clearToasts();
    drainStashedToast();
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((toast) =>
      setTimeout(() => dismissToast(toast.id), TOAST_TIMEOUT_MS),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [items]);

  // Render nothing at all until there is something to show. This is what keeps the portal out of
  // hydration: `useSyncExternalStore` uses `getServerSnapshot` on the server *and* through
  // hydration, so both sides agree on "empty → null". A toast can only arrive after that, as an
  // ordinary client update, by which point `document` certainly exists.
  //
  // The previous version gated on `typeof document`, which rendered the portal on the client's
  // first pass while the server had rendered nothing there — a hydration mismatch that regenerated
  // the whole tree.
  if (items.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
      {items.map((toast) => (
        <div
          key={toast.id}
          // `alert` interrupts a screen reader and `status` does not: a confirmation should not cut
          // across what the user is doing, a failure should.
          role={toast.variant === 'error' ? 'alert' : 'status'}
          aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
          className={cn(
            'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg',
            toast.variant === 'error' && 'border-destructive/40 bg-destructive/10 text-destructive',
            toast.variant === 'success' && 'border-success/40 bg-success/10 text-success',
            toast.variant === 'info' && 'border-border bg-muted/40 text-muted-foreground',
          )}
        >
          <span className="flex-1">{toast.text}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label={t('common.dismiss')}
            className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
