import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

/**
 * Enforces ADR-0003's no-new-UI-dependencies decision, which PRD-0012 builds on: the mobile drawer
 * reuses the Radix dialog that is already here, the toast (TKT-0089) is hand-rolled, and the
 * responsive table (TKT-0086) is CSS. PRD-0004 shed three dependencies to get here and RES-0003
 * rejected the shadcn multi-select specifically because it pulls in `cmdk`.
 *
 * Scoped to the decision rather than to one ticket, so it keeps holding for the rest of the epic.
 * If a future ADR reverses the decision, delete the offending entry here as part of that change —
 * that is the point of the test, not an obstacle to it.
 */

const DECLINED = [
  // Drawer / sheet libraries — TKT-0085 uses @radix-ui/react-dialog instead.
  'vaul',
  'react-modal-sheet',
  '@headlessui/react',
  // Command palette / combobox — rejected in RES-0003.
  'cmdk',
  // Date pickers — native date/time/datetime-local inputs stay (PRD-0004, ADR-0003).
  'react-day-picker',
  'react-datepicker',
  // Toasts — TKT-0089 is hand-rolled.
  'sonner',
  'react-hot-toast',
  'react-toastify',
  // Calendar + date libraries — PRD-0014 builds the calendar in-house (TKT-0099);
  // RES-0006 rejected all three libraries and ADR-0003 keeps date handling on plain Date/Intl.
  '@fullcalendar/react',
  'react-big-calendar',
  '@schedule-x/calendar',
  'date-fns',
  'dayjs',
  'moment',
];

describe('frontend dependencies', () => {
  it('already carries the Radix dialog the mobile drawer reuses', () => {
    expect(pkg.dependencies).toHaveProperty('@radix-ui/react-dialog');
  });

  it('carries none of the UI libraries ADR-0003 declined', () => {
    const installed = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    const found = DECLINED.filter((name) => installed.has(name));
    expect(found).toEqual([]);
  });
});
