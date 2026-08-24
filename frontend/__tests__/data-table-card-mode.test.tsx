import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable, type DataTableColumn } from '@/components/data-table';

// DataTable calls useRouter for the row navigation (TKT-0088); none of these tests navigate.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

interface Row {
  id: string;
  name: string;
  size: string;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Main Hall', size: 'Large' },
  { id: 'b', name: 'Studio 2', size: 'Small' },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name },
  { key: 'size', header: 'Size', cell: (r) => r.size },
];

function renderTable(rows: Row[] | null = ROWS) {
  return render(
    <DataTable
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.id}
      emptyText="none here"
      actions={(r) => <button type="button">{`act-${r.id}`}</button>}
    />,
  );
}

const GLOBALS_CSS = readFileSync(
  path.resolve(__dirname, '..', 'app', 'globals.css'),
  'utf8',
);

describe('DataTable card mode', () => {
  // AC #2 — the attribute content: attr(data-label) reads.
  it('labels every data cell with its column header', () => {
    const { container } = renderTable();
    const firstRow = container.querySelector('tbody tr');
    expect(firstRow).not.toBeNull();

    const labelled = Array.from(firstRow!.querySelectorAll('td[data-label]')).map((td) => [
      td.getAttribute('data-label'),
      td.textContent,
    ]);

    expect(labelled).toEqual([
      ['Name', 'Main Hall'],
      ['Size', 'Large'],
    ]);
  });

  // AC #2 — the actions cell is chrome, not a field, so it carries no label.
  it('leaves the actions cell unlabelled', () => {
    const { container } = renderTable();
    const cells = Array.from(container.querySelectorAll('tbody tr:first-child td'));
    const last = cells.at(-1);
    expect(last).toBeDefined();

    expect(last!.textContent).toBe('act-a');
    expect(last!.hasAttribute('data-label')).toBe(false);
  });

  // AC #3 — the hook the media query keys off. The rendered layout is not assertable here:
  // vitest.config.ts sets `css: false` and matchMedia is stubbed to `matches: false`.
  it('opts the table into card mode via a class the CSS can key off', () => {
    const { container } = renderTable();
    const wrapper = container.querySelector('.pd-card-table');

    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('table')).not.toBeNull();
  });

  // AC #4 + AC #3 — the rule exists, is scoped, uses attr(), and lives in @layer components.
  it('keeps the card rule inside the @layer components block in globals.css', () => {
    const layerStart = GLOBALS_CSS.indexOf('@layer components');
    expect(layerStart).toBeGreaterThan(-1);
    const layer = GLOBALS_CSS.slice(layerStart);

    expect(layer).toContain('max-width: 767px');
    expect(layer).toContain('.pd-card-table');
    expect(layer).toContain('attr(data-label)');
  });

  // AC #3 — the header row must leave the viewport without leaving the accessibility tree,
  // so it must not be display:none.
  it('hides the header row without removing it from the accessibility tree', () => {
    const layer = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('@layer components'));
    const headerRule = layer.slice(layer.indexOf('.pd-card-table thead tr'));
    const declarations = headerRule.slice(0, headerRule.indexOf('}'));

    expect(declarations).toContain('position: absolute');
    expect(declarations).not.toContain('display: none');
  });

  // AC #5 — display:block on table elements drops the implicit table roles in some browsers,
  // so the roles are declared explicitly. jsdom never applies the CSS, so this asserts the
  // markup contract rather than the browser outcome.
  it('keeps table semantics: table, row and cell roles all resolve', () => {
    const { container } = renderTable();

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBe(3); // header + 2 data rows
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Name',
      'Size',
      '',
    ]);
    expect(screen.getAllByRole('cell').length).toBe(6); // 2 rows x (2 fields + actions)

    // The role queries above pass on implicit roles alone, so in jsdom — which never applies the
    // stylesheet — they would stay green even if the explicit roles were missing. The point of the
    // explicit roles is the *browser* case, where changing `display` on table elements drops the
    // implicit ones. So assert the attributes are really in the markup.
    expect(container.querySelector('table')?.getAttribute('role')).toBe('table');
    expect(container.querySelector('thead')?.getAttribute('role')).toBe('rowgroup');
    expect(container.querySelector('tbody')?.getAttribute('role')).toBe('rowgroup');
    expect(container.querySelector('tbody tr')?.getAttribute('role')).toBe('row');
    expect(container.querySelector('thead th')?.getAttribute('role')).toBe('columnheader');
    expect(container.querySelector('tbody td')?.getAttribute('role')).toBe('cell');
  });

  // AC #6 — the empty state spans every column and is not a field.
  it('leaves the empty state unlabelled and centred', () => {
    const { container } = renderTable([]);
    const cell = screen.getByText('none here');

    expect(cell.getAttribute('colspan')).toBe('3');
    expect(cell.hasAttribute('data-label')).toBe(false);
    expect(cell.className).toMatch(/text-center/);
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
  });

  // TKT-0087 AC #4 — the rule is shared, never forked. If a second table ever grows its own
  // near-identical copy, this fails.
  it('shares one card rule across every opted-in table', () => {
    const layer = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('@layer components'));

    expect(layer.match(/attr\(data-label\)/g)?.length).toBe(1);
    expect(layer.match(/max-width:\s*767px/g)?.length).toBe(1);
  });

  // TKT-0087 AC #4 — card mode is opt-in, which is what keeps it away from the sr-only backing
  // table in fees-chart.tsx. A static scan catches an accidental future opt-in that rendering
  // one component would not.
  it('opts in exactly the intended tables, and never the chart backing table', () => {
    const root = path.resolve(__dirname, '..');
    const hits: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          if (readFileSync(full, 'utf8').includes('pd-card-table')) {
            hits.push(path.relative(root, full).replace(/\\/g, '/'));
          }
        }
      }
    };
    walk(path.join(root, 'app'));
    walk(path.join(root, 'components'));

    expect(hits.sort()).toEqual([
      'app/(dashboard)/fees/[id]/page.tsx',
      'app/(dashboard)/sessions/[id]/attendance/page.tsx',
      'components/data-table.tsx',
    ]);
    expect(hits).not.toContain('components/fees-chart.tsx');
  });

  // AC #7 — skeleton rows are placeholders, not records.
  it('marks skeleton rows and leaves their cells unlabelled', () => {
    const { container } = renderTable(null);
    const rows = container.querySelectorAll('tbody tr');

    expect(rows.length).toBe(3);
    for (const row of Array.from(rows)) {
      expect(row.hasAttribute('data-skeleton')).toBe(true);
      expect(row.querySelectorAll('td[data-label]').length).toBe(0);
    }
  });
});
