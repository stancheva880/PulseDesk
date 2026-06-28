import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import HomePage from '@/app/page';
import { I18nProvider } from '@/components/i18n-provider';

function renderHome() {
  return render(
    <I18nProvider>
      <HomePage />
    </I18nProvider>,
  );
}

describe('HomePage', () => {
  it('renders the app name + welcome copy in Bulgarian by default', async () => {
    renderHome();
    expect(await screen.findByRole('heading', { name: /PulseDesk/i })).toBeInTheDocument();
    expect(await screen.findByText(/Добре дошли/)).toBeInTheDocument();
  });

  it('switches the welcome copy to English when the English button is clicked', async () => {
    const user = userEvent.setup();
    renderHome();
    await screen.findByText(/Добре дошли/);
    // The compact LanguageSwitcher renders ISO codes (EN / BG).
    await user.click(screen.getByRole('button', { name: /^en$/i }));
    expect(await screen.findByText(/Welcome to PulseDesk/)).toBeInTheDocument();
  });
});
