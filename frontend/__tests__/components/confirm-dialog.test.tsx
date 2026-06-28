import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { I18nProvider } from '@/components/i18n-provider';

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <I18nProvider>
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete location 'Hall A'?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={onConfirm}
        {...props}
      />
    </I18nProvider>,
  );
  return { onConfirm, onOpenChange };
}

describe('ConfirmDialog', () => {
  it('renders the title and both action buttons when open', async () => {
    setup();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText("Delete location 'Hall A'?")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('fires onConfirm only when the confirm button is clicked', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('disables both buttons while busy', async () => {
    setup({ busy: true });
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
