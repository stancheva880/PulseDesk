import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { I18nProvider } from '@/components/i18n-provider';

beforeEach(() => {
  // next-themes reads/writes localStorage by default
  localStorage.clear();
});

function renderToggle() {
  return render(
    <I18nProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ThemeToggle />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('ThemeToggle', () => {
  it('renders a labelled trigger button', async () => {
    renderToggle();
    const trigger = await screen.findByRole('button', { name: /Theme|Тема/i });
    expect(trigger).toBeInTheDocument();
  });

  it('opens the menu and shows three theme options on click', async () => {
    const user = userEvent.setup();
    renderToggle();
    const trigger = await screen.findByRole('button', { name: /Theme|Тема/i });
    await user.click(trigger);

    expect(await screen.findByRole('menuitem', { name: /Light|Светла/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Dark|Тъмна/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /System|Системна/i })).toBeInTheDocument();
  });

  it('persists the chosen theme to localStorage', async () => {
    const user = userEvent.setup();
    renderToggle();
    const trigger = await screen.findByRole('button', { name: /Theme|Тема/i });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: /Dark|Тъмна/i }));

    // next-themes default key is "theme"
    await vi.waitFor(() => expect(localStorage.getItem('theme')).toBe('dark'));
  });

  it('cycles through all three theme values', async () => {
    const user = userEvent.setup();
    renderToggle();
    const trigger = await screen.findByRole('button', { name: /Theme|Тема/i });

    for (const [name, expected] of [
      [/Light|Светла/i, 'light'],
      [/Dark|Тъмна/i, 'dark'],
      [/System|Системна/i, 'system'],
    ] as const) {
      await user.click(trigger);
      await user.click(await screen.findByRole('menuitem', { name }));
      await vi.waitFor(() => expect(localStorage.getItem('theme')).toBe(expected));
    }
  });
});
