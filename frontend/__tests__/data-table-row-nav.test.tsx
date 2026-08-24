import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataTable, type DataTableColumn } from '@/components/data-table';

// TKT-0088: a row is a second, larger way into the record. The actions-cell controls keep
// winning over the row handler — that propagation rule is the whole risk in the ticket.

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/rows',
}));

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: 'r1', name: 'Ada' },
  { id: 'r2', name: 'Bob' },
];

const COLUMNS: DataTableColumn<Row>[] = [{ key: 'name', header: 'Name', cell: (r) => r.name }];

const rowHref = (r: Row) => `/rows/${r.id}`;

afterEach(() => {
  push.mockReset();
});

describe('DataTable — row navigation', () => {
  // AC #5 shape: no actions prop at all, the row still navigates.
  it('navigates on a cell click, with no actions prop', () => {
    render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} emptyText="—" rowHref={rowHref} />,
    );

    fireEvent.click(screen.getByText('Ada'));

    expect(push).toHaveBeenCalledWith('/rows/r1');
  });

  // AC #4 shape: actions renders but returns null for this role.
  it('navigates when actions returns null', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        emptyText="—"
        actions={() => null}
        rowHref={rowHref}
      />,
    );

    fireEvent.click(screen.getByText('Bob'));

    expect(push).toHaveBeenCalledWith('/rows/r2');
  });

  // AC #2: keyboard — in tab order, visible focus, Enter opens.
  it('is focusable and Enter on the row navigates', () => {
    render(
      <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} emptyText="—" rowHref={rowHref} />,
    );
    const row = screen.getByText('Ada').closest('tr')!;

    expect(row.tabIndex).toBe(0);
    expect(row.className).toMatch(/focus-visible:/);

    fireEvent.keyDown(row, { key: 'Enter' });

    expect(push).toHaveBeenCalledWith('/rows/r1');
  });

  // AC #3: a control inside the actions cell wins — only the action runs, no navigation.
  it('a button in the actions cell runs its action and does not navigate', () => {
    const onDelete = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        emptyText="—"
        actions={() => (
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        )}
        rowHref={rowHref}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

    expect(onDelete).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('a link in the actions cell does not trigger the row navigation', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        emptyText="—"
        actions={(r) => <a href={`/rows/${r.id}/edit`}>Edit</a>}
        rowHref={rowHref}
      />,
    );

    fireEvent.click(screen.getAllByText('Edit')[0]!);

    expect(push).not.toHaveBeenCalled();
  });

  it('Enter on a control inside the row does not trigger the row navigation', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        emptyText="—"
        actions={() => <button type="button">Delete</button>}
        rowHref={rowHref}
      />,
    );

    fireEvent.keyDown(screen.getAllByRole('button', { name: 'Delete' })[0]!, { key: 'Enter' });

    expect(push).not.toHaveBeenCalled();
  });

  it('without rowHref the row stays inert', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} emptyText="—" />);
    const row = screen.getByText('Ada').closest('tr')!;

    expect(row.hasAttribute('tabindex')).toBe(false);
    fireEvent.click(screen.getByText('Ada'));

    expect(push).not.toHaveBeenCalled();
  });

  it('a per-row undefined href leaves only that row inert', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        emptyText="—"
        rowHref={(r) => (r.id === 'r1' ? undefined : `/rows/${r.id}`)}
      />,
    );

    fireEvent.click(screen.getByText('Ada'));
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Bob'));
    expect(push).toHaveBeenCalledWith('/rows/r2');
  });
});
