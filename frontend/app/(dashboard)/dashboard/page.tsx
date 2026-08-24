'use client';

import { CalendarClock, Dumbbell, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FeesChart } from '@/components/fees-chart';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { isManager } from '@/lib/auth-storage';
import { apiErrorMessage } from '@/lib/api';
import { Classes, Locations, Sessions } from '@/lib/api-resources';

interface StatProps {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hint?: string;
  /** TKT-0096: set only once the count has loaded — a skeleton tile must not navigate. */
  href?: string;
}

function Stat({ label, value, icon, hint, href }: StatProps) {
  const card = (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          {icon}
        </span>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
  if (!href) return card;
  // The whole card is the anchor — the full tap target on a phone, a real link for the keyboard.
  return (
    <Link
      href={href}
      className="block rounded-lg transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {card}
    </Link>
  );
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}
function endOfWeek(d: Date): Date {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 7);
  return x;
}

export default function DashboardHomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);
  const [stats, setStats] = useState<{
    locations: number | null;
    activeClasses: number | null;
    sessionsThisWeek: number | null;
  }>({ locations: null, activeClasses: null, sessionsThisWeek: null });
  // A failed count is not a count of zero: writing 0 rendered a broken request as a real
  // but empty tenant. The layout holds this page back until a tenant is active, so
  // anything that fails here is a genuine failure.
  const [error, setError] = useState<string | null>(null);
  const onFailure = (e: unknown) => setError(apiErrorMessage(e));
  // TKT-0096: computed once and shared by the count request and the tile's link, so the tile
  // and the list it opens agree even if the render crosses a week boundary.
  const [week] = useState(() => {
    const now = new Date();
    return { from: startOfWeek(now).toISOString(), before: endOfWeek(now).toISOString() };
  });

  useEffect(() => {
    // Exact counts from the pagination envelope — no rows are needed for a number. `pageSize: 1`
    // rather than 0 because the envelope is what is being read and 1 is the smallest page the API
    // serves; the single row that comes back is ignored. Both filters are applied by the server
    // now: counting active classes or this week's sessions in the browser meant downloading every
    // class and every session first, which grew with the club and never stopped growing.
    Locations.list({ pageSize: 1 })
      .then((r) => setStats((s) => ({ ...s, locations: r.total })))
      .catch(onFailure);
    Classes.list({ pageSize: 1, isActive: true })
      .then((r) => setStats((s) => ({ ...s, activeClasses: r.total })))
      .catch(onFailure);
    // The week stays computed here, in the viewer's own timezone, and travels as two instants —
    // half-open, exactly as the client-side comparison it replaces (`ts >= start && ts < end`).
    Sessions.list({
      pageSize: 1,
      startsAtFrom: week.from,
      startsAtBefore: week.before,
    })
      .then((r) => setStats((s) => ({ ...s, sessionsThisWeek: r.total })))
      .catch(onFailure);
  }, [week]);

  const renderValue = (n: number | null) =>
    n === null ? <Skeleton className="h-8 w-12" /> : n.toLocaleString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label={t('nav.locations')}
            value={renderValue(stats.locations)}
            icon={<MapPin className="h-4 w-4" />}
            href={stats.locations !== null ? '/locations' : undefined}
          />
          <Stat
            label={t('nav.classes')}
            value={renderValue(stats.activeClasses)}
            icon={<Dumbbell className="h-4 w-4" />}
            hint={t('common.active')}
            href={stats.activeClasses !== null ? '/classes?isActive=true' : undefined}
          />
          <Stat
            label={t('nav.sessions')}
            value={renderValue(stats.sessionsThisWeek)}
            icon={<CalendarClock className="h-4 w-4" />}
            href={
              stats.sessionsThisWeek !== null
                ? `/sessions?startsAtFrom=${encodeURIComponent(week.from)}&startsAtBefore=${encodeURIComponent(week.before)}`
                : undefined
            }
          />
        </div>
      )}

      {admin ? <FeesChart /> : null}
    </div>
  );
}
