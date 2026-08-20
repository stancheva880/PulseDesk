'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiErrorMessage } from '@/lib/api';
import {
  Attendances,
  Sessions,
  type AttendanceStatus,
  type AttendanceWithTrainee,
  type SessionDetail,
  type Trainee,
  listAll,
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

// Still paged: the candidate set is filtered, not necessarily short.
const listCandidates = (sessionId: string) =>
  listAll((p) => Attendances.listCandidates(sessionId, p));

export default function AttendancePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sessionId = params.id;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [rows, setRows] = useState<AttendanceWithTrainee[] | null>(null);
  // The server's answer to "who can still be added", not a club-wide list to filter.
  const [candidates, setCandidates] = useState<Trainee[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [addId, setAddId] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // The API capped the response, so rows the trainer cannot see exist and Save All would not
  // cover them. Never silent: that silence is what TKT-0068 fixed.
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    Promise.all([
      Sessions.get(sessionId),
      Attendances.listForSession(sessionId),
      listCandidates(sessionId),
    ])
      .then(([s, a, cs]) => {
        setSession(s);
        setRows(a.items);
        setTruncated(a.truncated);
        setCandidates(cs);
        setDrafts(seedDrafts(a.items));
      })
      .catch((e: unknown) => setLoadError(apiErrorMessage(e)));
  }, [sessionId]);

  const setDraftStatus = (rowId: string, status: AttendanceStatus) => {
    setSavedCount(null);
    setDrafts((prev) => {
      const existing = prev[rowId] ?? { status, notes: '', changed: false };
      return { ...prev, [rowId]: { ...existing, status, changed: true } };
    });
  };
  const setDraftNotes = (rowId: string, notes: string) => {
    setSavedCount(null);
    setDrafts((prev) => {
      const existing = prev[rowId] ?? { status: 'PRESENT' as AttendanceStatus, notes, changed: false };
      return { ...prev, [rowId]: { ...existing, notes, changed: true } };
    });
  };

  const onAddTrainee = async () => {
    if (!addId) return;
    setAddError(null);
    setSavedCount(null);
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
      setCandidates(freshCandidates);
      setDrafts(seedDrafts(fresh.items));
      setAddId('');
    } catch (e) {
      setAddError(apiErrorMessage(e));
    } finally {
      setAddBusy(false);
    }
  };

  const onSaveAll = async () => {
    if (!rows) return;
    setSaveError(null);
    setSavedCount(null);

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
      setSavedCount(result.updated);
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
            {rows !== null ? (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('attendance.allEnrolled')}</p>
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
                  </>
                )}
                {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
              </div>
            ) : null}
            {rows === null ? (
              <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('attendance.empty')}</p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-md border">
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
                            <td className="p-3 font-medium">{name}</td>
                            <td className="p-3">
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
                            <td className="p-3 text-muted-foreground">
                              {row.traineeRsvp ? t(`attendance.rsvp.${row.traineeRsvp}`) : '—'}
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {row.markedByEmailSnapshot ?? '—'}
                              {row.markedAt ? (
                                <div>{new Date(row.markedAt).toLocaleString()}</div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {savedCount !== null ? (
                  <p className="text-sm text-green-700">
                    {t('attendance.savedAt', { updated: savedCount })}
                  </p>
                ) : null}
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
