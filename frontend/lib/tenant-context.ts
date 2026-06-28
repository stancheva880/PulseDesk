// SUPER_ADMIN tenant context — the tenant whose data they're acting on.
// Persisted to localStorage so it survives page reloads. Tenant users (ADMIN/EMPLOYEE/
// CUSTOMER) inherit tenant from their JWT and never write here; the backend ignores
// any X-Tenant-Id sent by tenant users.

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
