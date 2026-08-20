import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'next-themes';
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

  // TKT-0015 change request (approved): the dropdown menu became a cycle button —
  // clicking advances light → dark → system. Persistence and all-three-values
  // intents preserved through the same localStorage assertions.
  it('persists the chosen theme to localStorage on click', async () => {
    const user = userEvent.setup();
    renderToggle();
    const trigger = await screen.findByRole('button', { name: /Theme|Тема/i });
    // Default is system → first click lands on light.
    await user.click(trigger);

    // next-themes default key is "theme"
    await vi.waitFor(() => expect(localStorage.getItem('theme')).toBe('light'));
  });

  it('cycles through all three theme values and labels the active mode', async () => {
    const user = userEvent.setup();
    renderToggle();

    for (const [expected, label] of [
      ['light', /Light|Светла/i],
      ['dark', /Dark|Тъмна/i],
      ['system', /System|Системна/i],
    ] as const) {
      const trigger = await screen.findByRole('button', { name: /Theme|Тема/i });
      await user.click(trigger);
      await vi.waitFor(() => expect(localStorage.getItem('theme')).toBe(expected));
      // aria-label names the currently active mode.
      await vi.waitFor(() => {
        const btn = screen.getByRole('button', { name: /Theme|Тема/i });
        expect(btn.getAttribute('aria-label')).toMatch(label);
      });
    }
  });
});
