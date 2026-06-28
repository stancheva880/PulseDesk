'use client';

import { CalendarClock, Dumbbell, MapPin } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FeesChart } from '@/components/fees-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Classes, Locations, Sessions } from '@/lib/api-resources';

interface StatProps {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hint?: string;
}

function Stat({ label, value, icon, hint }: StatProps) {
  return (
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
  const [stats, setStats] = useState<{
    locations: number | null;
    activeClasses: number | null;
    sessionsThisWeek: number | null;
  }>({ locations: null, activeClasses: null, sessionsThisWeek: null });

  useEffect(() => {
    Locations.list()
      .then((rows) => setStats((s) => ({ ...s, locations: rows.length })))
      .catch(() => setStats((s) => ({ ...s, locations: 0 })));
    Classes.list()
      .then((rows) =>
        setStats((s) => ({ ...s, activeClasses: rows.filter((c) => c.isActive).length })),
      )
      .catch(() => setStats((s) => ({ ...s, activeClasses: 0 })));
    Sessions.list()
      .then((rows) => {
        const start = startOfWeek(new Date()).getTime();
        const end = endOfWeek(new Date()).getTime();
        const inWeek = rows.filter((r) => {
          const ts = new Date(r.startsAt).getTime();
          return ts >= start && ts < end;
        }).length;
        setStats((s) => ({ ...s, sessionsThisWeek: inWeek }));
      })
      .catch(() => setStats((s) => ({ ...s, sessionsThisWeek: 0 })));
  }, []);

  const renderValue = (n: number | null) =>
    n === null ? <Skeleton className="h-8 w-12" /> : n.toLocaleString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={t('nav.locations')}
          value={renderValue(stats.locations)}
          icon={<MapPin className="h-4 w-4" />}
        />
        <Stat
          label={t('nav.classes')}
          value={renderValue(stats.activeClasses)}
          icon={<Dumbbell className="h-4 w-4" />}
          hint={t('common.active')}
        />
        <Stat
          label={t('nav.sessions')}
          value={renderValue(stats.sessionsThisWeek)}
          icon={<CalendarClock className="h-4 w-4" />}
        />
      </div>

      <FeesChart />
    </div>
  );
}
