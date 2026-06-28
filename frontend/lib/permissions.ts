import type { UserRole } from './auth-storage';

// Write actions (create/update/delete/generate) across the dashboard are ADMIN-only on the backend
// (SUPER_ADMIN bypasses every @Roles check). EMPLOYEE/CUSTOMER are read-or-scoped. Use this to hide
// controls a non-manager can't use — the backend remains the real enforcement.
export const isManager = (role?: UserRole | null): boolean =>
  role === 'ADMIN' || role === 'SUPER_ADMIN';
