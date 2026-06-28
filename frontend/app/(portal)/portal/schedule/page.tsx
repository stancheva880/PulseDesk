'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import {
  Attendances,
  type AttendanceRsvp,
  type CustomerSessionEntry,
} from '@/lib/api-resources';
import { cn } from '@/lib/utils';

const RSVP_OPTIONS = ['CONFIRMED', 'DECLINED', 'RESCHEDULE_REQUESTED'] as const satisfies readonly AttendanceRsvp[];

export default function PortalSchedulePage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CustomerSessionEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ type: 'ok' | 'err'; key: string } | null>(null);

  const reload = () => {
    Attendances.myUpcoming()
      .then(setEntries)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : 'load failed'));
  };

  useEffect(reload, []);

  const onRsvp = async (sessionId: string, attendanceId: string, traineeId: string, choice: AttendanceRsvp) => {
    setPendingId(attendanceId);
    setFlash(null);
    try {
      await Attendances.rsvp(sessionId, { traineeId, traineeRsvp: choice });
      // Optimistic local update so the UI reflects the choice without a re-fetch.
      setEntries((prev) =>
        prev
          ? prev.map((entry) =>
              entry.id === sessionId
                ? {
                    ...entry,
                    attendances: entry.attendances.map((a) =>
                      a.id === attendanceId ? { ...a, traineeRsvp: choice } : a,
                    ),
                  }
                : entry,
            )
          : prev,
      );
      setFlash({ type: 'ok', key: 'rsvpSaved' });
    } catch (e) {
      setFlash({ type: 'err', key: e instanceof ApiError ? e.message : 'rsvpFailed' });
    } finally {
      setPendingId(null);
    }
  };

  const formatTime = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('portal.scheduleTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('portal.scheduleSubtitle')}</p>
      </div>

      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

      {flash?.type === 'ok' ? (
        <p className="text-sm text-green-700">{t(`portal.${flash.key}`)}</p>
      ) : flash?.type === 'err' ? (
        <p className="text-sm text-destructive">{t('portal.rsvpFailed')}</p>
      ) : null}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('portal.empty')}</p>
      ) : (
        <ul className="space-y-4">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {entry.class.name} · {formatTime(entry.startsAt)}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{entry.location.name}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {entry.attendances.length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    entry.attendances.map((a) => {
                      const name = `${a.trainee.firstName} ${a.trainee.lastName}`;
                      return (
                        <div key={a.id} className="space-y-2">
                          <div className="text-sm font-medium">{name}</div>
                          <div
                            role="group"
                            aria-label={t('portal.rsvpFor', { name })}
                            className="flex flex-wrap gap-2"
                          >
                            {RSVP_OPTIONS.map((opt) => {
                              const active = a.traineeRsvp === opt;
                              const busy = pendingId === a.id;
                              return (
                                <Button
                                  key={opt}
                                  type="button"
                                  size="sm"
                                  variant={active ? 'default' : 'outline'}
                                  disabled={busy}
                                  aria-pressed={active}
                                  onClick={() => void onRsvp(entry.id, a.id, a.trainee.id, opt)}
                                  className={cn(active ? '' : 'text-muted-foreground')}
                                >
                                  {t(`portal.rsvp.${opt}`)}
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
