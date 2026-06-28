import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@/components/i18n-provider';
import { Sidebar } from '@/components/sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/locations',
}));

describe('Sidebar', () => {
  it('renders all 8 nav items with their accessible labels', async () => {
    render(
      <I18nProvider>
        <Sidebar />
      </I18nProvider>,
    );
    for (const labelRe of [
      /Dashboard|Табло/,
      /Locations|Локации/,
      /Classes|Класове/,
      /Schedules|Графици/,
      /Sessions|Тренировки/,
      /Trainees|Трениращи/,
      /Fees|Такси/,
      /Users|Потребители/,
    ]) {
      expect(await screen.findByRole('link', { name: labelRe })).toBeInTheDocument();
    }
  });

  it('marks the link matching the current pathname as active (orange accent + aria-current)', async () => {
    render(
      <I18nProvider>
        <Sidebar />
      </I18nProvider>,
    );
    const active = await screen.findByRole('link', { name: /Locations|Локации/ });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveAttribute('data-active', 'true');
    expect(active.className).toMatch(/text-accent-foreground|bg-accent/);
  });

  it('renders a brand mark with the app name', async () => {
    render(
      <I18nProvider>
        <Sidebar />
      </I18nProvider>,
    );
    expect(await screen.findByText(/PulseDesk/)).toBeInTheDocument();
  });
});
