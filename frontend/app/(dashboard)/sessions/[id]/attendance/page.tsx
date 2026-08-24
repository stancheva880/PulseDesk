'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { showToast } from '@/components/toast';
import { ApiError, apiErrorMessage } from '@/lib/api';
import {
  Attendances,
  Sessions,
  Waitlist,
  type AttendanceStatus,
  type AttendanceWithTrainee,
  type CandidateTrainee,
  type SessionDetail,
  type WaitlistEntry,
} from '@/lib/api-resources';
import { cn } from '@/lib/utils';

const STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED'] as const satisfies readonly AttendanceStatus[];

interface RowDraft {
  status: AttendanceStatus;
  notes: string;
  changed: boolean;
}

// Seed drafts: keep PENDING rows as PRESENT defaults so trainers can just hit Save All;
// already-marked rows preserve their status.
function seedDrafts(rows: AttendanceWithTrainee[]): Record<string, RowDraft> {
  const initial: Record<string, RowDraft> = {};
  for (const row of rows) {
    initial[row.id] = {
      status: row.status === 'PENDING' ? 'PRESENT' : row.status,
      notes: row.notes ?? '',
      changed: false,
    };
  }
  return initial;
}

// Still paged: the candidate set is filtered, not necessarily short. Follows the remaining
// pages like listAll, but keeps the envelope's spotsLeft (TKT-0103) from the first page.
async function listCandidates(sessionId: string) {
  const first = await Attendances.listCandidates(sessionId, { pageSize: 100 });
  const items = [...first.items];
  for (let page = 2; page <= first.totalPages; page += 1) {
    items.push(...(await Attendances.listCandidates(sessionId, { page, pageSize: 100 })).items);
  }
  return { items, spotsLeft: first.spotsLeft };
}

export default function AttendancePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [rows, setRows] = useState<AttendanceWithTrainee[] | null>(null);
  // The server's answer to "who can still be added", not a club-wide list to filter.
  const [candidates, setCandidates] = useState<CandidateTrainee[]>([]);
  // TKT-0103: null = the class has no capacity; 0 disables the add control.
  const [spotsLeft, setSpotsLeft] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // TKT-0112: the session's queue; joins are offered only when the session is full.
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [waitId, setWaitId] = useState('');
  const [waitBusy, setWaitBusy] = useState(false);
  const [waitError, setWaitError] = useState<string | null>(null);
  // The API capped the response, so rows the trainer cannot see exist and Save All would not
  // cover them. Never silent: that silence is what TKT-0068 fixed.
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    // TKT-0123: four requests, and the id can change under them — moving between sessions used to
    // let a slower earlier load paint its rows over the newer session's. The trainer would then be
    // marking attendance against the wrong list. Same guard as auth-provider.tsx's bootstrap.
    let cancelled = false;
    Promise.all([
      Sessions.get(sessionId),
      Attendances.listForSession(sessionId),
      listCandidates(sessionId),
      Waitlist.list(sessionId),
    ])
      .then(([s, a, cs, w]) => {
        if (cancelled) return;
        setSession(s);
        setRows(a.items);
        setTruncated(a.truncated);
        setCandidates(cs.items);
        setSpotsLeft(cs.spotsLeft);
        setWaitlist(w);
        setDrafts(seedDrafts(a.items));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(apiErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const setDraftStatus = (rowId: string, status: AttendanceStatus) => {
    setDrafts((prev) => {
      const existing = prev[rowId] ?? { status, notes: '', changed: false };
      return { ...prev, [rowId]: { ...existing, status, changed: true } };
    });
  };
  const setDraftNotes = (rowId: string, notes: string) => {
    setDrafts((prev) => {
      const existing = prev[rowId] ?? { status: 'PRESENT' as AttendanceStatus, notes, changed: false };
      return { ...prev, [rowId]: { ...existing, notes, changed: true } };
    });
  };

  const onAddTrainee = async () => {
    if (!addId) return;
    setAddError(null);
    setAddBusy(true);
    try {
      await Attendances.addTrainee(sessionId, addId);
      const [fresh, freshCandidates] = await Promise.all([
        Attendances.listForSession(sessionId),
        // The person just added is no longer a candidate, and the server is the one that knows.
        listCandidates(sessionId),
      ]);
      setRows(fresh.items);
      setTruncated(fresh.truncated);
      setCandidates(freshCandidates.items);
      setSpotsLeft(freshCandidates.spotsLeft);
      setDrafts(seedDrafts(fresh.items));
      setAddId('');
    } catch (e) {
      setAddError(apiErrorMessage(e));
      // TKT-0112: a racing add filled the session — refresh spotsLeft so the control
      // flips to the waitlist offer.
      if (
        e instanceof ApiError &&
        (e.body as { code?: string } | undefined)?.code === 'ATTENDANCE_SESSION_FULL'
      ) {
        listCandidates(sessionId)
          .then((cs) => {
            setCandidates(cs.items);
            setSpotsLeft(cs.spotsLeft);
          })
          .catch(() => undefined);
      }
    } finally {
      setAddBusy(false);
    }
  };

  // TKT-0113: after an unbooking the server may have promoted someone — rows, candidates,
  // spotsLeft and the queue can all have changed, so everything refetches together.
  const refetchAll = async () => {
    const [fresh, freshCandidates, w] = await Promise.all([
      Attendances.listForSession(sessionId),
      listCandidates(sessionId),
      Waitlist.list(sessionId),
    ]);
    setRows(fresh.items);
    setTruncated(fresh.truncated);
    setCandidates(freshCandidates.items);
    setSpotsLeft(freshCandidates.spotsLeft);
    setWaitlist(w);
    setDrafts(seedDrafts(fresh.items));
  };

  const onRemoveRow = async (attendanceId: string) => {
    setSaveError(null);
    try {
      await Attendances.remove(sessionId, attendanceId);
      await refetchAll();
    } catch (e) {
      setSaveError(apiErrorMessage(e));
    }
  };

  const onJoinWaitlist = async () => {
    if (!waitId) return;
    setWaitError(null);
    setWaitBusy(true);
    try {
      await Waitlist.join(sessionId, { traineeId: waitId });
      setWaitlist(await Waitlist.list(sessionId));
      setWaitId('');
    } catch (e) {
      setWaitError(apiErrorMessage(e));
    } finally {
      setWaitBusy(false);
    }
  };

  const onRemoveWaitlist = async (entryId: string) => {
    setWaitError(null);
    try {
      await Waitlist.remove(sessionId, entryId);
      setWaitlist(await Waitlist.list(sessionId));
    } catch (e) {
      setWaitError(apiErrorMessage(e));
    }
  };

  const onSaveAll = async () => {
    if (!rows) return;
    setSaveError(null);

    // Send every row that has been touched. For untouched PENDING rows we still send the
    // default-PRESENT draft so the bulk PUT becomes a single transactional snapshot of
    // "what the trainer saw"; if you want a stricter "only-changed" semantic flip changed→true
    // selectively here.
    const items = rows.flatMap((r) => {
      const draft = drafts[r.id];
      if (!draft) return [];
      return [{
        traineeId: r.traineeId,
        status: draft.status,
        notes: draft.notes || undefined,
      }];
    });
    if (items.length === 0) return;

    setBusy(true);
    try {
      const result = await Attendances.bulkMark(sessionId, { items });
      showToast({ text: t('attendance.savedAt', { updated: result.updated }), variant: 'success' });
      // Refetch to pick up updated marker info.
      const fresh = await Attendances.listForSession(sessionId);
      setRows(fresh.items);
      setTruncated(fresh.truncated);
    } catch (e) {
      setSaveError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // TKT-0112: the queue is offered only when the class opted in; queued trainees are
  // not offered a second time.
  const waitlistEnabled =
    session?.class.waitlistMode === 'FIFO_AUTO' || session?.class.waitlistMode === 'CLAIM';
  const queuedIds = new Set(waitlist.map((w) => w.traineeId));
  const waitlistCandidates = candidates.filter((c) => !queuedIds.has(c.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('attendance.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('attendance.subtitle')}</p>
      </div>

      {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}

      {session ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {session.class.name} — {new Date(session.startsAt).toLocaleString()}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{session.location.name}</p>
          </CardHeader>
          <CardContent>
            {truncated ? (
              <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {t('attendance.truncated')}
              </p>
            ) : null}
            {rows !== null && session.class.capacity != null ? (
              <p className="mb-2 text-sm text-muted-foreground">
                {t('attendance.occupied', {
                  n: session.class.capacity - (spotsLeft ?? 0),
                  max: session.class.capacity,
                })}
              </p>
            ) : null}
            {rows !== null ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('attendance.allEnrolled')}</p>
                ) : spotsLeft === 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground">{t('attendance.full')}</p>
                    {waitlistEnabled ? (
                      <>
                        <select
                          aria-label={t('waitlist.add')}
                          value={waitId}
                          onChange={(e) => setWaitId(e.target.value)}
                          className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="">{t('waitlist.add')}</option>
                          {waitlistCandidates.map((tr) => (
                            <option key={tr.id} value={tr.id}>
                              {tr.firstName} {tr.lastName}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!waitId || waitBusy}
                          onClick={() => void onJoinWaitlist()}
                        >
                          {t('waitlist.cta')}
                        </Button>
                      </>
                    ) : null}
                  </>
                ) : (
                  <>
                    <select
                      aria-label={t('attendance.addTrainee')}
                      value={addId}
                      onChange={(e) => setAddId(e.target.value)}
                      className="flex h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">{t('attendance.addTrainee')}</option>
                      {candidates.map((tr) => (
                        <option key={tr.id} value={tr.id}>
                          {tr.firstName} {tr.lastName}
                          {/* TKT-0108: ex-card-holder with nothing usable left — warn, never block. */}
                          {tr.card === null && tr.hasCards ? ` — ${t('cards.noVisitsSuffix')}` : ''}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!addId || addBusy}
                      onClick={() => void onAddTrainee()}
                    >
                      {t('attendance.addTraineeCta')}
                    </Button>
                    {(() => {
                      const chosen = candidates.find((c) => c.id === addId);
                      return chosen && chosen.card === null && chosen.hasCards ? (
                        <p className="w-full text-sm text-warning-foreground dark:text-warning">
                          {t('cards.noVisitsWarning')}
                        </p>
                      ) : null;
                    })()}
                  </>
                )}
                {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
              </div>
            ) : null}
            {rows !== null && (waitlistEnabled || waitlist.length > 0) ? (
              <div className="mb-4 rounded-md border p-3">
                <p className="mb-2 text-sm font-medium">{t('waitlist.title')}</p>
                {waitlist.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('waitlist.empty')}</p>
                ) : (
                  <ul className="space-y-1">
                    {waitlist.map((w, i) => (
                      <li
                        key={w.id}
                        data-testid="waitlist-entry"
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="text-muted-foreground">{i + 1}.</span>
                        <span className="flex-1">
                          {w.trainee.firstName} {w.trainee.lastName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(w.createdAt).toLocaleString()}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void onRemoveWaitlist(w.id)}
                        >
                          {t('waitlist.remove')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {waitError ? <p className="mt-2 text-sm text-destructive">{waitError}</p> : null}
              </div>
            ) : null}
            {rows === null ? (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('attendance.empty')}</p>
            ) : (
              <div className="space-y-3">
                {/* pd-card-table opts this table into the below-md card layout defined once in
                    globals.css (TKT-0086). Each cell carries its own `data-label`, which the rule
                    renders as a caption via content: attr(data-label). */}
                <div className="pd-card-table rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="p-3 text-left font-medium">
                          {t('attendance.fields.trainee')}
                        </th>
                        <th className="p-3 text-left font-medium">
                          {t('attendance.fields.status')}
                        </th>
                        <th className="p-3 text-left font-medium">
                          {t('attendance.fields.rsvp')}
                        </th>
                        <th className="p-3 text-left font-medium">
                          {t('attendance.fields.marker')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const draft = drafts[row.id];
                        const name = `${row.trainee.firstName} ${row.trainee.lastName}`;
                        return (
                          <tr key={row.id} className="border-t align-top">
                            <td data-label={t('attendance.fields.trainee')} className="p-3 font-medium">
                              {name}
                            </td>
                            <td data-label={t('attendance.fields.status')} className="p-3">
                              <div role="group" aria-label={t('attendance.fields.status')} className="flex gap-1">
                                {STATUSES.map((s) => {
                                  const active = draft?.status === s;
                                  return (
                                    <button
                                      type="button"
                                      key={s}
                                      onClick={() => setDraftStatus(row.id, s)}
                                      aria-pressed={active}
                                      className={cn(
                                        'rounded-md border px-3 py-1 text-xs transition-colors',
                                        active
                                          ? 'border-primary bg-primary text-primary-foreground'
                                          : 'border-input bg-background text-muted-foreground hover:bg-accent',
                                      )}
                                    >
                                      {t(`attendance.status.${s}`)}
                                    </button>
                                  );
                                })}
                              </div>
                              <input
                                type="text"
                                value={draft?.notes ?? ''}
                                onChange={(e) => setDraftNotes(row.id, e.target.value)}
                                placeholder={t('sessions.fields.notes')}
                                className="mt-2 flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                              />
                            </td>
                            <td
                              data-label={t('attendance.fields.rsvp')}
                              className="p-3 text-muted-foreground"
                            >
                              {row.traineeRsvp ? t(`attendance.rsvp.${row.traineeRsvp}`) : '—'}
                            </td>
                            <td
                              data-label={t('attendance.fields.marker')}
                              className="p-3 text-xs text-muted-foreground"
                            >
                              {row.markedByEmailSnapshot ?? '—'}
                              {row.markedAt ? (
                                <div>{new Date(row.markedAt).toLocaleString()}</div>
                              ) : null}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-2"
                                onClick={() => void onRemoveRow(row.id)}
                              >
                                {t('attendance.removeRow')}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}

                <div className="flex gap-2">
                  <Button onClick={() => void onSaveAll()} disabled={busy}>
                    {busy ? t('common.saving') : t('attendance.saveAll')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => router.back()}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
