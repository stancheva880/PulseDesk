import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/components/i18n-provider';
import { TablePagination } from '@/components/table-pagination';

function renderPager(info: Parameters<typeof TablePagination>[0]['info'], onPageChange = vi.fn()) {
  render(
    <I18nProvider>
      <TablePagination info={info} onPageChange={onPageChange} />
    </I18nProvider>,
  );
  return onPageChange;
}

describe('TablePagination', () => {
  it('renders nothing while loading or when everything fits on one page', () => {
    renderPager(null);
    renderPager({ page: 1, pageSize: 25, total: 10, totalPages: 1 });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the summary and disables Prev on the first page', () => {
    renderPager({ page: 1, pageSize: 25, total: 60, totalPages: 3 });
    const [prev, next] = screen.getAllByRole('button');
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();
  });

  it('disables Next on the last page', () => {
    renderPager({ page: 3, pageSize: 25, total: 60, totalPages: 3 });
    const [prev, next] = screen.getAllByRole('button');
    expect(prev).not.toBeDisabled();
    expect(next).toBeDisabled();
  });

  it('emits the adjacent page number on click', async () => {
    const onPageChange = renderPager({ page: 2, pageSize: 25, total: 60, totalPages: 3 });
    const [prev, next] = screen.getAllByRole('button');
    await userEvent.click(next!);
    expect(onPageChange).toHaveBeenCalledWith(3);
    await userEvent.click(prev!);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
