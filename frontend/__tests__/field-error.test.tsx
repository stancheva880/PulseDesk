import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldError, SubmitError } from '@/components/ui/field-error';
import { NativeSelect } from '@/components/ui/native-select';
import { I18nProvider } from '@/components/i18n-provider';

// TKT-0090: the one shared field-error component — a message with role="alert" and a stable id
// the input's aria-describedby points at; nothing renders while the field is valid.
describe('FieldError', () => {
  it('renders the translated message with role=alert and the given id', () => {
    render(
      <I18nProvider>
        <FieldError id="name-error" messageKey="common.errors.required" />
      </I18nProvider>,
    );

    const message = screen.getByRole('alert');
    expect(message).toHaveAttribute('id', 'name-error');
    // bg is the bundled default locale.
    expect(message).toHaveTextContent('Това поле е задължително.');
  });

  it('renders nothing without a message key', () => {
    render(
      <I18nProvider>
        <FieldError id="name-error" />
      </I18nProvider>,
    );

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SubmitError', () => {
  it('takes focus when the message appears, so it is announced and scrolled into view', () => {
    const { rerender } = render(
      <I18nProvider>
        <SubmitError message={null} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('alert')).toBeNull();

    rerender(
      <I18nProvider>
        <SubmitError message="Something broke" />
      </I18nProvider>,
    );

    const message = screen.getByRole('alert');
    expect(message).toHaveTextContent('Something broke');
    expect(document.activeElement).toBe(message);
  });
});

describe('NativeSelect invalid state', () => {
  it('shows the same invalid border Input shows when aria-invalid is set', () => {
    render(
      <NativeSelect aria-invalid data-testid="sel">
        <option value="">—</option>
      </NativeSelect>,
    );

    expect(screen.getByTestId('sel').className).toContain('aria-[invalid=true]:border-destructive');
  });
});
