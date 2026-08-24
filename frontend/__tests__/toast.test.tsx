import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { I18nProvider } from '@/components/i18n-provider';
import { ToastViewport, showToast, stashToast } from '@/components/toast';

/**
 * A stand-in for a page that reports a completed action. Unmounting it is how a route change is
 * simulated: the trigger goes away, the viewport does not.
 */
function Trigger({
  text,
  variant = 'success',
}: {
  text: string;
  variant?: 'success' | 'error' | 'info';
}) {
  useEffect(() => {
    showToast({ text, variant });
  }, [text, variant]);
  return <span>trigger mounted</span>;
}

function renderWithViewport(ui: React.ReactNode) {
  return render(
    <I18nProvider>
      <ToastViewport />
      {ui}
    </I18nProvider>,
  );
}

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // AC #1 — the portal is the point: a route change must not take the confirmation with it.
  it('renders into document.body, not the page container', async () => {
    const { container } = renderWithViewport(<Trigger text="Saved 2 rows" />);

    const toast = await screen.findByText('Saved 2 rows');
    expect(container.contains(toast)).toBe(false);
    expect(document.body.contains(toast)).toBe(true);
  });

  // AC #1 — unmounting the thing that raised the toast leaves the toast standing.
  it('survives its trigger unmounting', async () => {
    function Host({ show }: { show: boolean }) {
      return (
        <I18nProvider>
          <ToastViewport />
          {show ? <Trigger text="Created 3 fees" /> : null}
        </I18nProvider>
      );
    }
    const { rerender } = render(<Host show />);
    await screen.findByText('Created 3 fees');

    rerender(<Host show={false} />);

    expect(screen.queryByText('trigger mounted')).toBeNull();
    expect(screen.getByText('Created 3 fees')).toBeInTheDocument();
  });

  // AC #2 — `alert` interrupts a screen reader, `status` does not. A confirmation must not interrupt.
  it('uses status for success and alert for failure', async () => {
    renderWithViewport(
      <>
        <Trigger text="It worked" variant="success" />
        <Trigger text="It failed" variant="error" />
      </>,
    );

    const ok = await screen.findByText('It worked');
    const bad = await screen.findByText('It failed');

    const okRegion = ok.closest('[role]');
    const badRegion = bad.closest('[role]');
    expect(okRegion?.getAttribute('role')).toBe('status');
    expect(okRegion?.getAttribute('aria-live')).toBe('polite');
    expect(badRegion?.getAttribute('role')).toBe('alert');
  });

  // An outcome that is neither a success nor an error keeps the non-interrupting `status` role, so
  // moving such a message into a toast cannot silently promote it to an error.
  it('reports an info outcome as status, not alert', async () => {
    renderWithViewport(<Trigger text="Invite saved but no mail sent" variant="info" />);

    const region = (await screen.findByText('Invite saved but no mail sent')).closest('[role]');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.getAttribute('aria-live')).toBe('polite');
  });

  // AC #2 — auto-dismiss.
  it('auto-dismisses after the timeout', async () => {
    renderWithViewport(<Trigger text="Transient" />);
    await screen.findByText('Transient');

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => expect(screen.queryByText('Transient')).toBeNull());
  });

  // AC #2 — manual dismiss, before the timeout.
  it('can be dismissed manually', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithViewport(<Trigger text="Dismiss me" />);
    await screen.findByText('Dismiss me');

    const region = screen.getByText('Dismiss me').closest('[role]') as HTMLElement;
    await user.click(
      screen.getByRole('button', { name: /Dismiss message|Затвори съобщението/ }),
    );

    await waitFor(() => expect(screen.queryByText('Dismiss me')).toBeNull());
    expect(document.body.contains(region)).toBe(false);
  });

  // AC #3 — a queue-of-one is the easy implementation and it eats the second confirmation.
  it('shows two concurrent toasts', async () => {
    renderWithViewport(
      <>
        <Trigger text="First saved" />
        <Trigger text="Second saved" />
      </>,
    );

    expect(await screen.findByText('First saved')).toBeInTheDocument();
    expect(await screen.findByText('Second saved')).toBeInTheDocument();
  });

  /**
   * Regression guard. An earlier version gated the portal on `typeof document`, so the client's
   * first pass rendered it while the server had rendered nothing in that position — a hydration
   * mismatch that regenerated the whole tree and produced a console error on every page load.
   *
   * The invariant that was broken is "the server renders nothing for the viewport", and none of the
   * tests above can see it, because they never server-render. This one does.
   */
  it('renders nothing on the server, even with a toast already in the store', () => {
    showToast({ text: 'Raised before any render', variant: 'success' });

    const html = renderToString(
      <I18nProvider>
        <ToastViewport />
      </I18nProvider>,
    );

    expect(html).not.toContain('Raised before any render');
    expect(html).not.toContain('pointer-events-none');
  });

  // AC #5 support — the store is module-level, so a toast raised while nothing was rendering must
  // not leak into the next mount. Without this, tests contaminate each other.
  it('clears pending toasts when the viewport mounts', async () => {
    showToast({ text: 'Orphan from an earlier mount', variant: 'success' });

    renderWithViewport(<span>fresh</span>);

    await screen.findByText('fresh');
    expect(screen.queryByText('Orphan from an earlier mount')).toBeNull();
  });

  // TKT-0092 AC — the sessionStorage handoff for the one hard navigation (tenants/new).
  // A document navigation discards the module store; the stash is drained on the next mount.
  describe('sessionStorage handoff', () => {
    const KEY = 'pulsedesk.pendingToast';

    beforeEach(() => {
      window.sessionStorage.clear();
    });

    it('drains a stashed toast on viewport mount and clears the key', async () => {
      stashToast({ text: 'Club created', variant: 'success' });

      renderWithViewport(null);

      expect(await screen.findByText('Club created')).toBeInTheDocument();
      expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });

    it('the mount clear does not swallow the drained toast', async () => {
      // An orphan raised before mount must die (the existing clear) while the stash survives it.
      showToast({ text: 'Orphan', variant: 'success' });
      stashToast({ text: 'Handoff survivor', variant: 'success' });

      renderWithViewport(null);

      expect(await screen.findByText('Handoff survivor')).toBeInTheDocument();
      expect(screen.queryByText('Orphan')).toBeNull();
    });

    it('ignores malformed stash content without throwing', async () => {
      window.sessionStorage.setItem(KEY, '{not json');

      renderWithViewport(<span>page alive</span>);

      await screen.findByText('page alive');
      expect(screen.queryByRole('status')).toBeNull();
      expect(window.sessionStorage.getItem(KEY)).toBeNull();
    });
  });
});
