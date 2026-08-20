// Active-tenant context — the tenant whose data the user is acting on. Written by the
// login tenant picker (all roles) and the SUPER_ADMIN tenant selector; sent as the
// X-Tenant-Id header on every request. The backend validates it: memberships for
// tenant users, tenant existence for SUPER_ADMIN. Persisted to localStorage so it
// survives page reloads.

const STORAGE_KEY = 'pulsedesk.tenantContext';
const EVENT_NAME = 'pulsedesk:tenant-context-changed';

export function readTenantContext(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeTenantContext(tenantId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (tenantId) window.localStorage?.setItem(STORAGE_KEY, tenantId);
    else window.localStorage?.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { tenantId } }));
  } catch {
    /* private mode etc. — ignore */
  }
}

export function subscribeTenantContext(handler: (tenantId: string | null) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ tenantId: string | null }>).detail;
    handler(detail?.tenantId ?? null);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

// Fires when ANOTHER tab changes the active tenant — the native storage event only
// dispatches cross-tab (same-tab writes use the CustomEvent above).
export function subscribeCrossTabTenantChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue !== e.oldValue) handler();
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}

// Thin window.location wrappers so components stay testable under jsdom.
export function hardNavigate(url: string): void {
  window.location.assign(url);
}

export function reloadApp(): void {
  window.location.reload();
}
