'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { readStoredMemberships, type UserRole } from '@/lib/auth-storage';
import { listClubs } from '@/lib/api-resources';
import { readTenantContext, subscribeTenantContext, writeTenantContext } from '@/lib/tenant-context';

/**
 * Shared route guard for the (dashboard) and (portal) layouts.
 * Redirects anonymous visitors to /login and authenticated-but-denied ones to
 * `redirectTo`. Returns whether the layout may render its children.
 *
 * `allowed` is computed by the caller because the two layouts deny for different
 * reasons — and the dashboard sends CUSTOMERs and misplaced EMPLOYEEs to
 * different destinations, so `redirectTo` is the caller's decision too.
 */
export function useRequireRole(allowed: boolean, redirectTo: string): boolean {
  const router = useRouter();
  const { user, status } = useAuth();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    else if (status === 'authenticated' && !allowed) router.replace(redirectTo);
  }, [status, allowed, redirectTo, router]);

  return status === 'authenticated' && !!user && allowed;
}

export type ActiveTenantState = 'ready' | 'pending' | 'unselected' | 'empty' | 'failed';

// TKT-0055: 'loading' until GET /tenants answers. A failure is kept distinct from an empty
// list — collapsing the two would march an administrator to a creation form on a populated
// system, which is the mistake dashboard-page.test.tsx:41 records being fixed once already.
type ClubsState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'loaded'; ids: Set<string>; truncated: boolean };

/**
 * Active-tenant gate, shared by the (dashboard) and (portal) layouts. Every
 * tenant-scoped route needs an X-Tenant-Id, so with none set the whole page is 400s
 * (SUPER_ADMIN) or 403s (everyone else). A tenant user has exactly one sensible answer —
 * their first membership — so recover silently. A SUPER_ADMIN has to be asked, so the
 * caller renders a prompt in place of children.
 */
export function useActiveTenant(role: UserRole | undefined): ActiveTenantState {
  const { membershipsSettled } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(readTenantContext);
  // Only the id this document loaded with can be stale. Anything written afterwards came from a
  // deliberate action on this page — the login picker, the club selector, or the new-club form,
  // which writes the club it has just created — and is therefore newer than the club list fetched
  // at mount, so that list is no evidence against it.
  const [storedAtMount] = useState<string | null>(readTenantContext);

  // The header selector, the login picker and another tab all write through this channel.
  useEffect(() => subscribeTenantContext(setTenantId), []);

  useEffect(() => {
    if (tenantId || !role || role === 'SUPER_ADMIN') return;
    const first = readStoredMemberships()[0];
    if (first) writeTenantContext(first.tenantId);
  }, [tenantId, role]);

  // Only a SUPER_ADMIN needs the club list, and only to tell "no club exists yet" apart from
  // "none picked yet". A member must never request it: GET /tenants is @Roles(SUPER_ADMIN)
  // and would answer 403.
  const [clubs, setClubs] = useState<ClubsState>({ status: 'loading' });
  useEffect(() => {
    if (role !== 'SUPER_ADMIN') return;
    let cancelled = false;
    void listClubs().then(
      ({ clubs: found, truncated }) => {
        if (!cancelled) {
          setClubs({ status: 'loaded', ids: new Set(found.map((c) => c.id)), truncated });
        }
      },
      () => {
        if (!cancelled) setClubs({ status: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [role]);

  // TKT-0056: a stored club the server will not accept is dropped rather than displayed. Absence
  // from a truncated list is not proof of absence, so that case is left alone — above the cap the
  // selector cannot offer the club either, making the stored id the only way into it.
  const staleClub =
    role === 'SUPER_ADMIN' &&
    !!tenantId &&
    tenantId === storedAtMount &&
    clubs.status === 'loaded' &&
    !clubs.truncated &&
    !clubs.ids.has(tenantId);

  useEffect(() => {
    if (staleClub) writeTenantContext(null);
  }, [staleClub]);

  if (role === 'SUPER_ADMIN') {
    // The list is consulted before the stored club, so no page mounts — and therefore no request
    // carries the stored id — until it is known to be one the server will accept.
    if (clubs.status === 'loading') return 'pending';
    // A failure says nothing about whether the stored club is valid. Refusing to render would lock
    // an administrator out of a good club whenever this one request blips.
    if (clubs.status === 'failed') return tenantId ? 'ready' : 'failed';
    if (clubs.ids.size === 0) return 'empty';
    if (!tenantId || staleClub) return 'unselected';
    return 'ready';
  }
  // TKT-0057: a stored club the member's own snapshot does not list is suspect, so hold rather than
  // let pages mount and answer 403 for the length of the bootstrap window. Holding, never writing —
  // auth-provider.tsx:96-118 stays the only writer and decides from the server's answer rather than
  // this snapshot, so the two cannot race. A snapshot that does list the club is trusted at once,
  // which is TKT-0039's deliberate snapshot-first recovery and costs no round-trip. Once the sync has
  // answered, render either way: a failed sync says nothing about whether the club is valid, and
  // blocking on it would lock a member out of their own data over one bad request.
  if (!tenantId) return 'pending';
  if (readStoredMemberships().some((m) => m.tenantId === tenantId)) return 'ready';
  return membershipsSettled ? 'ready' : 'pending';
}
