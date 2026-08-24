import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/components/i18n-provider';
import {
  SessionCalendar,
  monthGridDays,
  overlapColumns,
  weekDays,
  type CalendarMode,
} from '@/components/session-calendar';
import type { SessionRow } from '@/lib/api-resources';

// Fixtures are built from local Dates so every assertion holds in any timezone — the same
// trick sessions-page.test.tsx uses (TKT-0094).
function makeSession(id: string, classId: string, start: Date, end: Date): SessionRow {
  return {
    id,
    tenantId: 't',
    classId,
    locationId: 'loc-1',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    status: 'SCHEDULED',
    notes: null,
    createdAt: '',
    updatedAt: '',
  } as SessionRow;
}

const CLASS_NAMES = new Map([
  ['c1', 'Yoga'],
  ['c2', 'Pilates'],
]);

function renderCalendar(over: {
  mode?: CalendarMode;
  anchor?: Date;
  sessions?: SessionRow[];
  readOnly?: boolean;
  chipExtra?: (s: SessionRow) => string | null;
  onModeChange?: (m: CalendarMode) => void;
  onAnchorChange?: (d: Date) => void;
  onShowDay?: (d: Date) => void;
}) {
  return render(
    <I18nProvider>
      <SessionCalendar
        mode={over.mode ?? 'month'}
        anchor={over.anchor ?? new Date(2026, 2, 15)}
        sessions={over.sessions ?? []}
        readOnly={over.readOnly}
        chipExtra={over.chipExtra}
        classNameById={CLASS_NAMES}
        onModeChange={over.onModeChange ?? vi.fn()}
        onAnchorChange={over.onAnchorChange ?? vi.fn()}
        onShowDay={over.onShowDay ?? vi.fn()}
      />
    </I18nProvider>,
  );
}

describe('calendar date math', () => {
  // AC #2/#10 — Monday-first month grid, including a month that starts on a Sunday:
  // March 2026 begins on Sunday, so the grid must reach back to Monday Feb 23.
  it('builds a Monday-first grid for a month starting on Sunday', () => {
    const days = monthGridDays(new Date(2026, 2, 15));
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual(new Date(2026, 1, 23));
    expect(days[41]).toEqual(new Date(2026, 3, 5));
  });

  it('builds the Monday-first week around any anchor day', () => {
    const days = weekDays(new Date(2026, 2, 4)); // a Wednesday
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual(new Date(2026, 2, 2));
    expect(days[6]).toEqual(new Date(2026, 2, 8));
  });

  // AC #4 — naive equal split: concurrent sessions share the column side-by-side.
  it('packs concurrent sessions into equal sub-columns and resets between clusters', () => {
    const day = (h: number, m: number) => new Date(2026, 2, 2, h, m);
    const a = makeSession('a', 'c1', day(10, 0), day(11, 0));
    const b = makeSession('b', 'c2', day(10, 30), day(11, 30));
    const c = makeSession('c', 'c1', day(12, 0), day(13, 0));

    const layout = overlapColumns([a, b, c]);

    expect(layout.get('a')).toEqual({ col: 0, cols: 2 });
    expect(layout.get('b')).toEqual({ col: 1, cols: 2 });
    expect(layout.get('c')).toEqual({ col: 0, cols: 1 });
  });
});

describe('SessionCalendar', () => {
  // AC #4 + #6 — the chip shows HH:MM + class name and links to the attendance page.
  it('renders a chip with start time and class name linking to attendance', () => {
    const start = new Date(2026, 2, 2, 10, 0);
    const { container } = renderCalendar({
      mode: 'month',
      anchor: new Date(2026, 2, 2),
      sessions: [makeSession('s1', 'c1', start, new Date(2026, 2, 2, 11, 0))],
    });

    const chip = container.querySelector('a[href="/sessions/s1/attendance"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain('10:00');
    expect(chip!.textContent).toContain('Yoga');
  });

  // AC #5 — at most 3 chips per month cell; the rest collapse into one "+X още" that
  // opens that day's Day view.
  it('collapses the fourth session of a day into +1 още which opens the day view', () => {
    const onShowDay = vi.fn();
    const mk = (id: string, h: number) =>
      makeSession(id, 'c1', new Date(2026, 2, 2, h, 0), new Date(2026, 2, 2, h + 1, 0));
    const { container } = renderCalendar({
      mode: 'month',
      anchor: new Date(2026, 2, 2),
      sessions: [mk('s1', 8), mk('s2', 10), mk('s3', 12), mk('s4', 14)],
      onShowDay,
    });

    expect(container.querySelectorAll('a[href^="/sessions/"]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '+1 още' }));
    expect(onShowDay).toHaveBeenCalledWith(new Date(2026, 2, 2));
  });

  // AC #7 — day names come from Intl.DateTimeFormat for the active (bg) locale, no date lib.
  it('renders Bulgarian weekday headers via Intl', () => {
    renderCalendar({ mode: 'month', anchor: new Date(2026, 2, 15) });

    const monday = new Intl.DateTimeFormat('bg', { weekday: 'short' }).format(
      new Date(2026, 2, 2),
    );
    expect(screen.getAllByText(monday).length).toBeGreaterThan(0);
  });

  // AC #2 — all three modes render; the mode switch reports changes.
  it('offers month, week and day modes through the switch', () => {
    const onModeChange = vi.fn();
    renderCalendar({ mode: 'week', anchor: new Date(2026, 2, 4), onModeChange });

    fireEvent.click(screen.getByRole('button', { name: 'Месец' }));
    expect(onModeChange).toHaveBeenCalledWith('month');
    fireEvent.click(screen.getByRole('button', { name: 'Ден' }));
    expect(onModeChange).toHaveBeenCalledWith('day');
  });

  // AC #8 — prev/next/today step the anchor by one period of the active mode.
  it('steps the anchor by one week in week mode', () => {
    const onAnchorChange = vi.fn();
    renderCalendar({ mode: 'week', anchor: new Date(2026, 2, 4), onAnchorChange });

    fireEvent.click(screen.getByRole('button', { name: 'Следващ период' }));
    expect(onAnchorChange).toHaveBeenCalledWith(new Date(2026, 2, 11));

    fireEvent.click(screen.getByRole('button', { name: 'Предишен период' }));
    expect(onAnchorChange).toHaveBeenCalledWith(new Date(2026, 1, 25));
  });

  it('steps the anchor to the first of the adjacent month in month mode', () => {
    const onAnchorChange = vi.fn();
    renderCalendar({ mode: 'month', anchor: new Date(2026, 2, 15), onAnchorChange });

    fireEvent.click(screen.getByRole('button', { name: 'Следващ период' }));
    expect(onAnchorChange).toHaveBeenCalledWith(new Date(2026, 3, 1));
  });

  it('jumps to today via the today button', () => {
    const onAnchorChange = vi.fn();
    renderCalendar({ mode: 'day', anchor: new Date(2026, 2, 4), onAnchorChange });

    fireEvent.click(screen.getByRole('button', { name: 'Днес' }));
    const sent = onAnchorChange.mock.calls[0]![0] as Date;
    const now = new Date();
    expect([sent.getFullYear(), sent.getMonth(), sent.getDate()]).toEqual([
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ]);
  });

  // AC #4 — week mode positions chips by start/end time inside the day column.
  // TKT-0103 AC #7 — occupancy (or anything else) rides on the chip via chipExtra.
  it('appends chipExtra to the chip label', () => {
    const { container } = renderCalendar({
      mode: 'month',
      anchor: new Date(2026, 2, 2),
      sessions: [makeSession('s1', 'c1', new Date(2026, 2, 2, 10, 0), new Date(2026, 2, 2, 11, 0))],
      chipExtra: () => '3/8',
    });

    const chip = container.querySelector('a[href="/sessions/s1/attendance"]');
    expect(chip!.textContent).toContain('3/8');
  });

  // TKT-0102 AC #3 — the portal's read-only mode: same chips, zero links, in both grid kinds.
  it('renders chips without links in readOnly mode', () => {
    const mk = (id: string) =>
      makeSession(id, 'c1', new Date(2026, 2, 2, 10, 0), new Date(2026, 2, 2, 11, 0));

    const month = renderCalendar({
      readOnly: true,
      mode: 'month',
      anchor: new Date(2026, 2, 2),
      sessions: [mk('s1')],
    });
    expect(month.container.querySelector('a')).toBeNull();
    expect(month.container.textContent).toContain('10:00');
    expect(month.container.textContent).toContain('Yoga');
    month.unmount();

    const week = renderCalendar({
      readOnly: true,
      mode: 'week',
      anchor: new Date(2026, 2, 2),
      sessions: [mk('s2')],
    });
    expect(week.container.querySelector('a')).toBeNull();
    expect(week.container.textContent).toContain('Yoga');
  });

  it('positions week-mode chips by their local start time', () => {
    const { container } = renderCalendar({
      mode: 'week',
      anchor: new Date(2026, 2, 4),
      sessions: [
        makeSession('s1', 'c1', new Date(2026, 2, 2, 10, 0), new Date(2026, 2, 2, 11, 30)),
      ],
    });

    const chip = container.querySelector<HTMLElement>('a[href="/sessions/s1/attendance"]');
    expect(chip).not.toBeNull();
    // The grid starts at 08:00 by default, one hour = 48px: 10:00 → 96px top, 1.5h → 72px.
    expect(chip!.style.top).toBe('96px');
    expect(chip!.style.height).toBe('72px');
  });
});
