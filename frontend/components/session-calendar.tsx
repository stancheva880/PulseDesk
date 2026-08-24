'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SessionRow } from '@/lib/api-resources';

// TKT-0099: plain Date + Intl only — ADR-0003 forbids a date library, and the grid math
// below is all the calendar needs. Weeks start on Monday throughout.

export type CalendarMode = 'month' | 'week' | 'day';

const HOUR_PX = 48; // one hour of the week/day time grid, in px

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function startOfWeekMonday(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeekMonday(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Monday-first grid covering the anchor's month, padded to whole weeks (28–42 days). */
export function monthGridDays(anchor: Date): Date[] {
  const first = startOfWeekMonday(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const end = addDays(startOfWeekMonday(lastOfMonth), 6);
  const days: Date[] = [];
  for (let d = first; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

export interface ChipLayout {
  col: number;
  cols: number;
}

/**
 * Naive equal-split overlap layout (PRD-0014): sessions are swept in start order; each takes
 * the first free sub-column, and every member of a transitively-overlapping cluster shares
 * the cluster's column count. Gym schedules are sparse, so this stays readable without the
 * full interval-graph treatment.
 */
export function overlapColumns(
  sessions: ReadonlyArray<Pick<SessionRow, 'id' | 'startsAt' | 'endsAt'>>,
): Map<string, ChipLayout> {
  const layout = new Map<string, ChipLayout>();
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  let colEnds: number[] = [];
  let cluster: string[] = [];
  let clusterEnd = 0;
  const flush = () => {
    for (const id of cluster) layout.get(id)!.cols = colEnds.length;
    colEnds = [];
    cluster = [];
    clusterEnd = 0;
  };
  for (const s of sorted) {
    const start = new Date(s.startsAt).getTime();
    const end = new Date(s.endsAt).getTime();
    if (cluster.length && start >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end);
    } else {
      colEnds[col] = end;
    }
    layout.set(s.id, { col, cols: 0 });
    cluster.push(s.id);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return layout;
}

/**
 * The half-open fetch window for a mode + anchor — month covers the whole visible grid
 * (adjacent-month cells included), so what is drawn is exactly what was fetched.
 */
export function calendarRange(
  mode: CalendarMode,
  anchor: Date,
): { from: string; before: string } {
  if (mode === 'month') {
    const days = monthGridDays(anchor);
    return {
      from: days[0]!.toISOString(),
      before: addDays(days[days.length - 1]!, 1).toISOString(),
    };
  }
  if (mode === 'week') {
    const start = startOfWeekMonday(anchor);
    return { from: start.toISOString(), before: addDays(start, 7).toISOString() };
  }
  const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  return { from: day.toISOString(), before: addDays(day, 1).toISOString() };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function hm(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isSameDay(day: Date, iso: string): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  );
}

function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

const byStart = (a: SessionRow, b: SessionRow) =>
  new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();

interface SessionCalendarProps {
  mode: CalendarMode;
  /** Any date inside the shown period; time of day is ignored. */
  anchor: Date;
  sessions: SessionRow[];
  classNameById: Map<string, string>;
  /** TKT-0102: the portal's mode — chips render as plain text, never as booking links. */
  readOnly?: boolean;
  /** TKT-0103: appended to the chip label — the staff page passes occupancy ("3/8"). */
  chipExtra?: (s: SessionRow) => string | null;
  onModeChange: (mode: CalendarMode) => void;
  onAnchorChange: (anchor: Date) => void;
  /** A month cell's "+X more" — switch to that day's Day view. */
  onShowDay: (day: Date) => void;
}

export function SessionCalendar({
  mode,
  anchor,
  sessions,
  classNameById,
  readOnly = false,
  chipExtra,
  onModeChange,
  onAnchorChange,
  onShowDay,
}: SessionCalendarProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const step = (dir: 1 | -1) => {
    if (mode === 'month') {
      onAnchorChange(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
    } else {
      onAnchorChange(addDays(anchor, (mode === 'week' ? 7 : 1) * dir));
    }
  };

  const title = (() => {
    if (mode === 'month') {
      return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(anchor);
    }
    if (mode === 'week') {
      const days = weekDays(anchor);
      const f = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
      const l = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' });
      return `${f.format(days[0]!)} – ${l.format(days[6]!)}`;
    }
    return new Intl.DateTimeFormat(lang, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(anchor);
  })();

  const chipLabel = (s: SessionRow) => {
    const extra = chipExtra?.(s);
    return `${hm(s.startsAt)} ${classNameById.get(s.classId) ?? '—'}${extra ? ` ${extra}` : ''}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            aria-label={t('sessions.calendar.prev')}
            onClick={() => step(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAnchorChange(new Date())}>
            {t('sessions.calendar.today')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('sessions.calendar.next')}
            onClick={() => step(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {(['month', 'week', 'day'] as const).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onModeChange(m)}
            >
              {t(`sessions.calendar.${m}`)}
            </Button>
          ))}
        </div>
      </div>

      {mode === 'month' ? (
        <MonthGrid
          anchor={anchor}
          sessions={sessions}
          chipLabel={chipLabel}
          lang={lang}
          readOnly={readOnly}
          moreLabel={(n) => t('sessions.calendar.more', { n })}
          onShowDay={onShowDay}
        />
      ) : (
        <TimeGrid
          days={mode === 'week' ? weekDays(anchor) : [addDays(anchor, 0)]}
          sessions={sessions}
          chipLabel={chipLabel}
          lang={lang}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

function MonthGrid({
  anchor,
  sessions,
  chipLabel,
  lang,
  readOnly,
  moreLabel,
  onShowDay,
}: {
  anchor: Date;
  sessions: SessionRow[];
  chipLabel: (s: SessionRow) => string;
  lang: string;
  readOnly: boolean;
  moreLabel: (n: number) => string;
  onShowDay: (day: Date) => void;
}) {
  const days = monthGridDays(anchor);
  const weekdayFmt = new Intl.DateTimeFormat(lang, { weekday: 'short' });
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-md border text-xs">
      {days.slice(0, 7).map((d) => (
        <div
          key={`h-${d.getDay()}`}
          className="border-b bg-muted/50 px-1 py-1.5 text-center font-medium text-muted-foreground"
        >
          {weekdayFmt.format(d)}
        </div>
      ))}
      {days.map((day) => {
        const daySessions = sessions.filter((s) => isSameDay(day, s.startsAt)).sort(byStart);
        const visible = daySessions.slice(0, 3);
        const extra = daySessions.length - visible.length;
        const otherMonth = day.getMonth() !== anchor.getMonth();
        return (
          <div
            key={day.toDateString()}
            className={cn('min-h-24 space-y-0.5 border-b border-r p-1', otherMonth && 'bg-muted/30')}
          >
            <div className={cn('text-right', otherMonth && 'text-muted-foreground')}>
              {day.getDate()}
            </div>
            {visible.map((s) =>
              readOnly ? (
                <span key={s.id} className="block truncate rounded bg-primary/10 px-1 py-0.5">
                  {chipLabel(s)}
                </span>
              ) : (
                <Link
                  key={s.id}
                  href={`/sessions/${s.id}/attendance`}
                  className="block truncate rounded bg-primary/10 px-1 py-0.5 hover:bg-primary/20"
                >
                  {chipLabel(s)}
                </Link>
              ),
            )}
            {extra > 0 ? (
              <button
                type="button"
                className="w-full text-left text-muted-foreground hover:underline"
                onClick={() => onShowDay(day)}
              >
                {moreLabel(extra)}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function TimeGrid({
  days,
  sessions,
  chipLabel,
  lang,
  readOnly,
}: {
  days: Date[];
  sessions: SessionRow[];
  chipLabel: (s: SessionRow) => string;
  lang: string;
  readOnly: boolean;
}) {
  // 08:00–20:00 by default, stretched so every visible session fits.
  let minHour = 8;
  let maxHour = 20;
  for (const s of sessions) {
    const start = new Date(s.startsAt);
    const end = new Date(s.endsAt);
    minHour = Math.min(minHour, start.getHours());
    maxHour = Math.max(maxHour, end.getMinutes() > 0 ? end.getHours() + 1 : end.getHours());
  }
  const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);
  const headerFmt = new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric' });

  return (
    <div className="overflow-x-auto rounded-md border">
      <div className={cn('flex', days.length > 1 && 'min-w-[560px]')}>
        <div className="w-12 shrink-0 border-r text-right text-xs text-muted-foreground">
          <div className="h-7 border-b" />
          <div className="relative" style={{ height: hours.length * HOUR_PX }}>
            {hours.map((h, i) => (
              <div key={h} className="absolute right-1" style={{ top: i * HOUR_PX }}>
                {pad(h)}:00
              </div>
            ))}
          </div>
        </div>
        <div
          className="grid flex-1"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
        >
          {days.map((day) => {
            const daySessions = sessions.filter((s) => isSameDay(day, s.startsAt)).sort(byStart);
            const layout = overlapColumns(daySessions);
            return (
              <div key={day.toDateString()} className="border-r last:border-r-0">
                <div className="h-7 border-b px-1 py-1 text-center text-xs font-medium text-muted-foreground">
                  {headerFmt.format(day)}
                </div>
                <div className="relative" style={{ height: hours.length * HOUR_PX }}>
                  {hours.map((h, i) =>
                    i > 0 ? (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-border/50"
                        style={{ top: i * HOUR_PX }}
                      />
                    ) : null,
                  )}
                  {daySessions.map((s) => {
                    const { col, cols } = layout.get(s.id)!;
                    const top = ((minutesOfDay(s.startsAt) - minHour * 60) / 60) * HOUR_PX;
                    const height = Math.max(
                      20,
                      ((minutesOfDay(s.endsAt) - minutesOfDay(s.startsAt)) / 60) * HOUR_PX,
                    );
                    const style = {
                      top,
                      height,
                      left: `${(col / cols) * 100}%`,
                      width: `${100 / cols}%`,
                    };
                    return readOnly ? (
                      <span
                        key={s.id}
                        className="absolute overflow-hidden rounded border border-primary/30 bg-primary/10 px-1 py-0.5 text-xs"
                        style={style}
                      >
                        {chipLabel(s)}
                      </span>
                    ) : (
                      <Link
                        key={s.id}
                        href={`/sessions/${s.id}/attendance`}
                        className="absolute overflow-hidden rounded border border-primary/30 bg-primary/10 px-1 py-0.5 text-xs hover:bg-primary/20"
                        style={style}
                      >
                        {chipLabel(s)}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
