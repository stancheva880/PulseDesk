import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { DateTimeInput } from '@/components/ui/date-time-input';

function Wrapper({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateTimeInput id="dt" value={value} onChange={setValue} />
      <output data-testid="emitted">{value}</output>
    </>
  );
}

describe('DateTimeInput', () => {
  it('splits an initial YYYY-MM-DDTHH:MM value into date and time fields', () => {
    render(<Wrapper initial="2026-05-13T14:30" />);
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    const time = document.querySelector('input[type="text"]') as HTMLInputElement;
    expect(date.value).toBe('2026-05-13');
    expect(time.value).toBe('14:30');
  });

  it('emits the combined YYYY-MM-DDTHH:MM value when both fields are filled', () => {
    render(<Wrapper />);
    const date = document.querySelector('input[type="date"]') as HTMLInputElement;
    const time = document.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(date, { target: { value: '2026-05-13' } });
    fireEvent.change(time, { target: { value: '09:15' } });
    expect(screen.getByTestId('emitted').textContent).toBe('2026-05-13T09:15');
  });

  it('renders a custom 24h text input for the time half, not a native type=time', () => {
    render(<Wrapper initial="2026-05-13T14:30" />);
    expect(document.querySelector('input[type="time"]')).toBeNull();
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
  });
});
