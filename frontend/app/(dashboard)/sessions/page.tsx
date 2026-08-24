'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/components/auth-provider';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import {
  SessionCalendar,
  calendarRange,
  type CalendarMode,
} from '@/components/session-calendar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClearableDateInput } from '@/components/ui/clearable-date-input';
import { Label } from '@/components/ui/label';
import { isManager } from '@/lib/auth-storage';
import { formatDateTime } from '@/lib/utils';
import {
  Classes,
  Locations,
  Sessions,
  Users,
  type ClassRow,
  type Location,
  type SessionRow,
  type UserRow,
  listAll,
} from '@/lib/api-resources';
import { useCrudList } from '@/lib/use-crud-list';
import { apiErrorMessage } from '@/lib/api';

// TKT-0094: the date range travels as instants, computed in the viewer's timezone — the same
// convention the dashboard's week tile uses. The inputs hold local yyyy-mm-dd; each maps to its
// local midnight, so `startsAtFrom` is inclusive of the whole day and `startsAtBefore` excludes
// everything from its day onward (the DTO's documented half-open contract).
function todayLocalDate(): string {
  const n = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}
function dayStartIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!).toISOString();
}
/** An instant from the URL, floored to its local date for the input; garbage → undefined. */
function isoToLocalDate(iso: string): string | undefined {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// TKT-0099: ?date= carries a local calendar day; garbage degrades to today, matching the
// posture of the legacy param parsing above.
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

// TKT-0100: the three id filters live in the URL and are sent by both views.
interface SessionFilters {
  classId?: string;
  trainerId?: string;
  locationId?: string;
}

function SessionsList({
  initialFrom,
  initialBefore,
  filters,
  classNameById,
  locationNameById,
}: {
  initialFrom?: string;
  initialBefore?: string;
  filters: SessionFilters;
  classNameById: Map<string, string>;
  locationNameById: Map<string, string>;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);

  // The default is start of today, not "now" — a class that finished this morning must still be
  // listed, because attendance is routinely marked after the class. The default reasserts on
  // every visit (PRD-0012's open question, resolved in the ticket).
  const [draft, setDraft] = useState(() => ({
    from: initialFrom ?? todayLocalDate(),
    before: initialBefore ?? '',
  }));
  // `range` is the applied filter; it follows `draft` only while the range is valid, so an
  // inverted range is rejected before any request is sent.
  const [range, setRange] = useState(draft);
  const invalidRange = Boolean(draft.from && draft.before && draft.before < draft.from);
  const updateDraft = (next: { from: string; before: string }) => {
    setDraft(next);
    if (!(next.from && next.before && next.before < next.from)) setRange(next);
  };
  const {
    rows,
    setPage,
    pageInfo,
    error,
    pendingDelete,
    setPendingDelete,
    busy,
    onDelete,
  } = useCrudList(Sessions, {
    params: {
      startsAtFrom: range.from ? dayStartIso(range.from) : undefined,
      startsAtBefore: range.before ? dayStartIso(range.before) : undefined,
      classId: filters.classId,
      trainerId: filters.trainerId,
      locationId: filters.locationId,
    },
    deps: [range.from, range.before, filters.classId, filters.trainerId, filters.locationId],
    deletedName: (s) =>
      `${classNameById.get(s.classId) ?? ''} ${formatDateTime(s.startsAt)}`.trim(),
  });

  const statusVariant = (status: string): 'success' | 'secondary' | 'destructive' => {
    if (status === 'COMPLETED') return 'success';
    if (status === 'CANCELLED') return 'destructive';
    return 'secondary';
  };

  const columns: DataTableColumn<SessionRow>[] = [
    {
      key: 'startsAt',
      header: t('sessions.fields.startsAt'),
      cell: (s) => formatDateTime(s.startsAt),
      skeleton: 'h-4 w-40',
    },
    {
      key: 'class',
      header: t('sessions.fields.class'),
      cell: (s) => classNameById.get(s.classId) ?? '—',
      skeleton: 'h-4 w-32',
    },
    {
      key: 'location',
      header: t('sessions.fields.location'),
      cell: (s) => locationNameById.get(s.locationId) ?? '—',
      cellClassName: 'text-muted-foreground',
      skeleton: 'h-4 w-24',
    },
    {
      key: 'status',
      header: t('sessions.fields.status'),
      cell: (s) => (
        <Badge variant={statusVariant(s.status)}>{t(`sessions.status.${s.status}`)}</Badge>
      ),
      skeleton: 'h-5 w-20 rounded-full',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="filter-from">{t('sessions.filters.from')}</Label>
          <ClearableDateInput
            id="filter-from"
            value={draft.from}
            onChange={(v) => updateDraft({ ...draft, from: v })}
            clearLabel={t('a11y.clearStartDate')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="filter-before">{t('sessions.filters.before')}</Label>
          <ClearableDateInput
            id="filter-before"
            value={draft.before}
            onChange={(v) => updateDraft({ ...draft, before: v })}
            clearLabel={t('a11y.clearEndDate')}
          />
          {invalidRange ? (
            <p className="text-xs text-destructive">{t('sessions.filters.order')}</p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        emptyText={t('sessions.empty')}
        // Mirrors the row's own controls: Edit is admin-only, and a trainer's record view is
        // the attendance ledger (their edit save could only 403).
        rowHref={(s) => (admin ? `/sessions/${s.id}/edit` : `/sessions/${s.id}/attendance`)}
        actions={(s) => (
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/sessions/${s.id}/attendance`}>{t('sessions.markAttendance')}</Link>
            </Button>
            {admin ? (
              <>
                <Button asChild variant="ghost" size="sm" className="ml-1">
                  <Link href={`/sessions/${s.id}/edit`}>{t('common.edit')}</Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setPendingDelete(s)}
                >
                  {t('common.delete')}
                </Button>
              </>
            ) : null}
          </>
        )}
        pageInfo={pageInfo}
        onPageChange={setPage}
        confirm={{
          open: pendingDelete !== null,
          onOpenChange: (open) => {
            if (!open) setPendingDelete(null);
          },
          title: t('sessions.deleteConfirm'),
          confirmLabel: t('common.delete'),
          cancelLabel: t('common.cancel'),
          onConfirm: onDelete,
          busy,
        }}
      />
    </div>
  );
}

function SessionsCalendarView({
  mode,
  anchor,
  filters,
  classNameById,
  classCapacityById,
  onModeChange,
  onAnchorChange,
  onShowDay,
}: {
  mode: CalendarMode;
  anchor: Date;
  filters: SessionFilters;
  classNameById: Map<string, string>;
  classCapacityById: Map<string, number | null>;
  onModeChange: (mode: CalendarMode) => void;
  onAnchorChange: (anchor: Date) => void;
  onShowDay: (day: Date) => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const range = calendarRange(mode, anchor);
  const { classId, trainerId, locationId } = filters;

  useEffect(() => {
    let cancelled = false;
    listAll((p) =>
      Sessions.list({
        ...p,
        startsAtFrom: range.from,
        startsAtBefore: range.before,
        classId,
        trainerId,
        locationId,
      }),
    )
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(apiErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [range.from, range.before, classId, trainerId, locationId]);

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <SessionCalendar
        mode={mode}
        anchor={anchor}
        sessions={sessions}
        classNameById={classNameById}
        // TKT-0103: occupancy chip — n from the list row's _count, cap from the class lookup.
        chipExtra={(s) => {
          const cap = classCapacityById.get(s.classId);
          const n = s._count?.attendances;
          return cap != null && n !== undefined ? `${n}/${cap}` : null;
        }}
        onModeChange={onModeChange}
        onAnchorChange={onAnchorChange}
        onShowDay={onShowDay}
      />
    </div>
  );
}

// TKT-0099: ?view=calendar|table, ?mode=month|week|day, ?date=YYYY-MM-DD all live in the URL,
// so reload and back/forward restore the exact view. The calendar is the default; the one
// carve-out is a URL carrying the legacy ?startsAtFrom/?startsAtBefore seam without a view —
// that is the dashboard tile's "filtered list" contract (TKT-0096) and keeps rendering the table.
function SessionsFromParams() {
  const params = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const admin = isManager(user?.role);

  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [trainers, setTrainers] = useState<UserRow[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([listAll(Classes.list), listAll(Locations.list)])
      .then(([c, l]) => {
        if (cancelled) return;
        setClasses(c);
        setLocations(l);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLookupError(apiErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // The trainer dropdown is part of the admin-only filter bar, and GET /users would 403 a
  // trainer anyway — so the lookup only runs for managers.
  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    listAll((p) => Users.list({ ...p, role: 'EMPLOYEE' }))
      .then((rows) => {
        if (!cancelled) setTrainers(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLookupError(apiErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [admin]);
  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name])), [classes]);
  const classCapacityById = useMemo(
    () => new Map(classes.map((c) => [c.id, c.capacity])),
    [classes],
  );
  const locationNameById = useMemo(
    () => new Map(locations.map((l) => [l.id, l.name])),
    [locations],
  );

  const fromParam = params.get('startsAtFrom');
  const beforeParam = params.get('startsAtBefore');
  const viewParam = params.get('view');
  const view: 'calendar' | 'table' =
    viewParam === 'table'
      ? 'table'
      : viewParam === 'calendar'
        ? 'calendar'
        : fromParam || beforeParam
          ? 'table'
          : 'calendar';
  const modeParam = params.get('mode');
  const mode: CalendarMode =
    modeParam === 'month' || modeParam === 'day' ? modeParam : 'week';
  const anchor = parseLocalDate(params.get('date')) ?? parseLocalDate(todayLocalDate())!;
  const filters: SessionFilters = {
    classId: params.get('classId') ?? undefined,
    trainerId: params.get('trainerId') ?? undefined,
    locationId: params.get('locationId') ?? undefined,
  };

  const setParams = (updates: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    router.replace(`/sessions?${next.toString()}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('sessions.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('sessions.subtitle')}</p>
        </div>
        {admin ? (
          <Button asChild>
            <Link href="/sessions/new">
              <Plus className="h-4 w-4" />
              {t('sessions.new')}
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant={view === 'calendar' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setParams({ view: 'calendar' })}
        >
          {t('sessions.calendar.view')}
        </Button>
        <Button
          variant={view === 'table' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setParams({ view: 'table' })}
        >
          {t('sessions.calendar.tableView')}
        </Button>
      </div>

      {admin ? (
        <div className="grid gap-3 sm:max-w-2xl sm:grid-cols-3">
          <FilterSelect
            id="filter-class"
            label={t('sessions.filters.class')}
            allLabel={t('sessions.filters.all')}
            value={filters.classId ?? ''}
            options={classes.map((c) => ({ value: c.id, label: c.name }))}
            onChange={(v) => setParams({ classId: v || undefined })}
          />
          <FilterSelect
            id="filter-trainer"
            label={t('sessions.filters.trainer')}
            allLabel={t('sessions.filters.all')}
            value={filters.trainerId ?? ''}
            options={trainers.map((u) => ({
              value: u.id,
              label: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
            }))}
            onChange={(v) => setParams({ trainerId: v || undefined })}
          />
          <FilterSelect
            id="filter-location"
            label={t('sessions.filters.location')}
            allLabel={t('sessions.filters.all')}
            value={filters.locationId ?? ''}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            onChange={(v) => setParams({ locationId: v || undefined })}
          />
        </div>
      ) : null}

      {lookupError ? (
        <p role="alert" className="text-sm text-destructive">
          {lookupError}
        </p>
      ) : null}

      {view === 'table' ? (
        <SessionsList
          initialFrom={fromParam ? isoToLocalDate(fromParam) : undefined}
          initialBefore={beforeParam ? isoToLocalDate(beforeParam) : undefined}
          filters={filters}
          classNameById={classNameById}
          locationNameById={locationNameById}
        />
      ) : (
        <SessionsCalendarView
          mode={mode}
          anchor={anchor}
          filters={filters}
          classNameById={classNameById}
          classCapacityById={classCapacityById}
          onModeChange={(m) => setParams({ view: 'calendar', mode: m })}
          onAnchorChange={(d) => setParams({ view: 'calendar', date: toYmd(d) })}
          onShowDay={(d) => setParams({ view: 'calendar', mode: 'day', date: toYmd(d) })}
        />
      )}
    </div>
  );
}

// Native select per ADR-0003 — the same posture as the tenant selector (TKT-0014).
function FilterSelect({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function SessionsListPage() {
  return (
    <Suspense fallback={null}>
      <SessionsFromParams />
    </Suspense>
  );
}
