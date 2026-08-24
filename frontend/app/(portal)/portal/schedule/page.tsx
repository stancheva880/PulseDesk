'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SessionCalendar,
  calendarRange,
  type CalendarMode,
} from '@/components/session-calendar';
import { showToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiErrorMessage } from '@/lib/api';
import {
  Attendances,
  Cards,
  Waitlist,
  type AttendanceRsvp,
  type CustomerCardEntry,
  type CustomerSessionEntry,
} from '@/lib/api-resources';
import { cn, formatDateTime } from '@/lib/utils';

// TKT-0118/0119: the one time window for customer self-service — flag on and the class's
// cutoff not yet reached. The server re-checks all of it; this only hides dead controls.
function selfServiceOpen(entry: CustomerSessionEntry, now: number): boolean {
  if (!entry.class.allowSelfBooking) return false;
  const closesAt =
    Date.parse(entry.startsAt) - (entry.class.bookingCutoffMin ?? 0) * 60_000;
  return now < closesAt;
}

// Booking additionally needs a free spot; cancelling a full session must always work.
function bookingOpen(entry: CustomerSessionEntry, now: number): boolean {
  return entry.spotsLeft !== 0 && selfServiceOpen(entry, now);
}

// Warn-allow, staff-flow mirror: only a trainee who owns cards but has none usable for this
// class gets the note. Card-less trainees are the monthly/course crowd — no note for them.
function noVisitsLeft(
  cards: CustomerCardEntry[] | null,
  traineeId: string,
  classId: string,
  now: number,
): boolean {
  if (!cards) return false;
  const own = cards.filter((c) => c.traineeId === traineeId);
  if (own.length === 0) return false;
  return !own.some(
    (c) =>
      c.cancelledAt === null &&
      (c.expiresAt === null || Date.parse(c.expiresAt) > now) &&
      c.visitsRemaining > 0 &&
      (c.class === null || c.class.id === classId),
  );
}

const RSVP_OPTIONS = ['CONFIRMED', 'DECLINED', 'RESCHEDULE_REQUESTED'] as const satisfies readonly AttendanceRsvp[];

// TKT-0102: ?date= carries a local calendar day, same contract as the staff calendar.
function parseLocalDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(y!, m! - 1, d!);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function toYmd(d: Date): string {
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function PortalScheduleList() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CustomerSessionEntry[] | null>(null);
  const [cards, setCards] = useState<CustomerCardEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Stable per mount — "booking closed" does not need to tick while the page is open;
  // the server is the authority anyway (a stale button just answers 409).
  const [now] = useState(() => Date.now());

  const reload = () => {
    Attendances.myUpcoming()
      .then((rows) => {
        setEntries(rows);
        // TKT-0118: the no-visits note needs the family's cards — fetched once, and only
        // when something on the page is self-bookable. A failure just drops the note.
        if (rows.some((r) => r.class.allowSelfBooking)) {
          Cards.myCards()
            .then(setCards)
            .catch(() => setCards(null));
        }
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  };

  useEffect(reload, []);

  const onBook = async (sessionId: string, traineeId: string) => {
    setPendingId(`book-${sessionId}-${traineeId}`);
    try {
      await Attendances.book(sessionId, traineeId);
      showToast({ text: t('portal.bookSaved'), variant: 'success' });
    } catch {
      // A race (filled up, cutoff passed) answers 409 — the refetch below shows the truth.
      showToast({ text: t('portal.bookFailed'), variant: 'error' });
    } finally {
      setPendingId(null);
      reload();
    }
  };

  // TKT-0121: queueing costs nothing — the visit is drawn only if a promotion books the trainee.
  const onJoinWaitlist = async (sessionId: string, traineeId: string) => {
    setPendingId(`queue-${sessionId}-${traineeId}`);
    try {
      await Waitlist.joinMine(sessionId, traineeId);
      showToast({ text: t('portal.joinWaitlistSaved'), variant: 'success' });
    } catch {
      showToast({ text: t('portal.joinWaitlistFailed'), variant: 'error' });
    } finally {
      setPendingId(null);
      reload();
    }
  };

  const onLeaveWaitlist = async (sessionId: string, traineeId: string) => {
    setPendingId(`unqueue-${sessionId}-${traineeId}`);
    try {
      await Waitlist.leaveMine(sessionId, traineeId);
      showToast({ text: t('portal.leaveWaitlistSaved'), variant: 'success' });
    } catch {
      showToast({ text: t('portal.leaveWaitlistFailed'), variant: 'error' });
    } finally {
      setPendingId(null);
      reload();
    }
  };

  // TKT-0119: the spot goes back to the club; the card visit returns server-side.
  const onCancel = async (sessionId: string, traineeId: string) => {
    setPendingId(`cancel-${sessionId}-${traineeId}`);
    try {
      await Attendances.cancelBooking(sessionId, traineeId);
      showToast({ text: t('portal.cancelSaved'), variant: 'success' });
    } catch {
      showToast({ text: t('portal.cancelFailed'), variant: 'error' });
    } finally {
      setPendingId(null);
      reload();
    }
  };

  const onRsvp = async (sessionId: string, attendanceId: string, traineeId: string, choice: AttendanceRsvp) => {
    setPendingId(attendanceId);
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
      showToast({ text: t('portal.rsvpSaved'), variant: 'success' });
    } catch {
      // Deliberately generic, not apiErrorMessage: the portal is the one surface a customer
      // sees, and the RSVP failures the server can answer with are staff-facing English.
      showToast({ text: t('portal.rsvpFailed'), variant: 'error' });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <>
      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

      {entries === null ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('portal.empty')}</p>
      ) : (
        <ul className="space-y-4">
          {entries.map((entry) => {
            // TKT-0118: family trainees enrolled in the class but not yet on the session.
            // TKT-0121: a queued one is neither bookable nor queueable — it gets its own row.
            const queued = new Set(entry.myWaitlist ?? []);
            const unbooked = (entry.myTrainees ?? []).filter(
              (tr) => !entry.attendances.some((a) => a.trainee.id === tr.id),
            );
            const bookable = bookingOpen(entry, now)
              ? unbooked.filter((tr) => !queued.has(tr.id))
              : [];
            // A full session offers the queue instead of Book — unless the class has none.
            const queueable =
              entry.spotsLeft === 0 &&
              entry.class.waitlistMode !== 'NONE' &&
              selfServiceOpen(entry, now)
                ? unbooked.filter((tr) => !queued.has(tr.id))
                : [];
            // Leaving is always allowed, so this row ignores the cutoff (server agrees).
            const queuedTrainees = unbooked.filter((tr) => queued.has(tr.id));
            const noSpots =
              entry.spotsLeft === 0 &&
              entry.class.waitlistMode === 'NONE' &&
              queuedTrainees.length === 0;
            // TKT-0119: cancelling stays open on a full session; past the cutoff the row
            // says so instead of offering a dead button.
            const canCancel = selfServiceOpen(entry, now);
            const pastCutoff = entry.class.allowSelfBooking && !canCancel;
            return (
            <li key={entry.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {entry.class.name} · {formatDateTime(entry.startsAt)}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{entry.location.name}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  {entry.attendances.length === 0 &&
                  bookable.length === 0 &&
                  queueable.length === 0 &&
                  queuedTrainees.length === 0 &&
                  !noSpots ? (
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
                            {canCancel ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pendingId === `cancel-${entry.id}-${a.trainee.id}`}
                                onClick={() => void onCancel(entry.id, a.trainee.id)}
                              >
                                {t('portal.cancelBooking')}
                              </Button>
                            ) : null}
                          </div>
                          {pastCutoff ? (
                            <p className="text-xs text-muted-foreground">
                              {t('portal.pastCutoffHint')}
                            </p>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                  {bookable.map((tr) => {
                    const name = `${tr.firstName} ${tr.lastName}`;
                    const busy = pendingId === `book-${entry.id}-${tr.id}`;
                    return (
                      <div key={tr.id} className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{name}</span>
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy}
                            onClick={() => void onBook(entry.id, tr.id)}
                          >
                            {t('portal.book')}
                          </Button>
                        </div>
                        {noVisitsLeft(cards, tr.id, entry.classId, now) ? (
                          <p className="text-xs text-muted-foreground">
                            {t('portal.noVisitsNote')}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  {queueable.map((tr) => (
                    <div key={`q-${tr.id}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {tr.firstName} {tr.lastName}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pendingId === `queue-${entry.id}-${tr.id}`}
                        onClick={() => void onJoinWaitlist(entry.id, tr.id)}
                      >
                        {t('portal.joinWaitlist')}
                      </Button>
                    </div>
                  ))}
                  {queuedTrainees.map((tr) => (
                    <div key={`w-${tr.id}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {tr.firstName} {tr.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t('portal.queuedBadge')}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pendingId === `unqueue-${entry.id}-${tr.id}`}
                        onClick={() => void onLeaveWaitlist(entry.id, tr.id)}
                      >
                        {t('portal.leaveWaitlist')}
                      </Button>
                    </div>
                  ))}
                  {noSpots ? (
                    <p className="text-sm text-muted-foreground">{t('portal.noSpots')}</p>
                  ) : null}
                </CardContent>
              </Card>
            </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// TKT-0102: read-only calendar over the same entries — RSVP stays in the list view.
function PortalScheduleCalendar({
  mode,
  anchor,
  onModeChange,
  onAnchorChange,
  onShowDay,
}: {
  mode: CalendarMode;
  anchor: Date;
  onModeChange: (mode: CalendarMode) => void;
  onAnchorChange: (anchor: Date) => void;
  onShowDay: (day: Date) => void;
}) {
  const [entries, setEntries] = useState<CustomerSessionEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const range = calendarRange(mode, anchor);

  useEffect(() => {
    let cancelled = false;
    Attendances.myUpcoming({ from: range.from, to: range.before })
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.before]);

  const classNameById = useMemo(
    () => new Map(entries.map((e) => [e.classId, e.class.name])),
    [entries],
  );

  return (
    <>
      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
      <SessionCalendar
        readOnly
        mode={mode}
        anchor={anchor}
        sessions={entries}
        classNameById={classNameById}
        onModeChange={onModeChange}
        onAnchorChange={onAnchorChange}
        onShowDay={onShowDay}
      />
    </>
  );
}

function PortalScheduleFromParams() {
  const { t } = useTranslation();
  const params = useSearchParams();
  const router = useRouter();

  const view: 'list' | 'calendar' = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const modeParam = params.get('mode');
  const mode: CalendarMode =
    modeParam === 'month' || modeParam === 'day' ? modeParam : 'week';
  const anchor = parseLocalDate(params.get('date')) ?? parseLocalDate(toYmd(new Date()))!;

  const setParams = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`/portal/schedule?${next.toString()}`);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('portal.scheduleTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('portal.scheduleSubtitle')}</p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant={view === 'list' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setParams({ view: undefined })}
        >
          {t('portal.listView')}
        </Button>
        <Button
          variant={view === 'calendar' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setParams({ view: 'calendar' })}
        >
          {t('sessions.calendar.view')}
        </Button>
      </div>

      {view === 'list' ? (
        <PortalScheduleList />
      ) : (
        <PortalScheduleCalendar
          mode={mode}
          anchor={anchor}
          onModeChange={(m) => setParams({ view: 'calendar', mode: m })}
          onAnchorChange={(d) => setParams({ view: 'calendar', date: toYmd(d) })}
          onShowDay={(d) => setParams({ view: 'calendar', mode: 'day', date: toYmd(d) })}
        />
      )}
    </div>
  );
}

export default function PortalSchedulePage() {
  return (
    <Suspense fallback={null}>
      <PortalScheduleFromParams />
    </Suspense>
  );
}
