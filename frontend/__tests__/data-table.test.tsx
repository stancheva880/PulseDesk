import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { I18nProvider } from '@/components/i18n-provider';

// DataTable calls useRouter for the row navigation (TKT-0088); none of these tests navigate.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

interface Row {
  id: string;
  name: string;
  size: number;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, cellClassName: 'font-medium' },
  { key: 'size', header: 'Size', cell: (r) => String(r.size), sortValue: (r) => r.size },
];

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', size: 2 },
  { id: 'b', name: 'Beta', size: 1 },
];

function renderTable(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('DataTable', () => {
  it('renders 3 skeleton rows while rows is null', () => {
    const { container } = renderTable(
      <DataTable columns={columns} rows={null} rowKey={(r) => r.id} emptyText="none" />,
    );
    expect(container.querySelectorAll('tbody tr').length).toBe(3);
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
  });

  it('renders the empty state with full colSpan when rows is empty', () => {
    const { container } = renderTable(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyText="none here"
        actions={() => null}
      />,
    );
    const cell = screen.getByText('none here');
    expect(cell.getAttribute('colspan')).toBe('3');
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('renders one row per item plus the actions cell', () => {
    const { container } = renderTable(
      <DataTable
        columns={columns}
        rows={ROWS}
        rowKey={(r) => r.id}
        emptyText="none"
        actions={(r) => <button type="button">act-{r.id}</button>}
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('act-b')).toBeInTheDocument();
    expect(container.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('sortable header shows the indicator and fires onSortToggle', () => {
    const onSortToggle = vi.fn();
    renderTable(
      <DataTable
        columns={columns}
        rows={ROWS}
        rowKey={(r) => r.id}
        emptyText="none"
        sort={{ key: 'size', desc: true }}
        onSortToggle={onSortToggle}
      />,
    );
    const sizeHeader = screen.getByText(/Size/).closest('th')!;
    expect(sizeHeader.textContent).toContain('▼');
    fireEvent.click(sizeHeader);
    expect(onSortToggle).toHaveBeenCalledWith('size');
    // Non-sortable header has no handler wired.
    const nameHeader = screen.getByText('Name').closest('th')!;
    fireEvent.click(nameHeader);
    expect(onSortToggle).toHaveBeenCalledTimes(1);
  });

  it('renders the confirm dialog when confirm.open is true', () => {
    const onConfirm = vi.fn();
    renderTable(
      <DataTable
        columns={columns}
        rows={ROWS}
        rowKey={(r) => r.id}
        emptyText="none"
        confirm={{
          open: true,
          onOpenChange: () => undefined,
          title: 'Really delete Alpha?',
          onConfirm,
          busy: false,
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Really delete Alpha?' })).toBeInTheDocument();
  });
});
