import type { UserRole } from './auth-storage';

// Where a user lands after login, based on role. Customers go to the read-only
// portal; admins/employees/super-admins land in the dashboard.
export function homePathForRole(role: UserRole): string {
  return role === 'CUSTOMER' ? '/portal/schedule' : '/dashboard';
}
