import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeInput } from '@/components/ui/time-input';

describe('TimeInput', () => {
  it('renders as a text input with HH:MM placeholder and numeric inputMode', () => {
    render(<TimeInput aria-label="time" />);
    const input = screen.getByLabelText('time') as HTMLInputElement;
    expect(input.type).toBe('text');
    expect(input.placeholder).toBe('HH:MM');
    expect(input.inputMode).toBe('numeric');
    expect(input.maxLength).toBe(5);
  });

  it('declares a 24-hour pattern that rejects values outside 00:00–23:59', () => {
    render(<TimeInput aria-label="time" />);
    const input = screen.getByLabelText('time') as HTMLInputElement;
    expect(input.pattern).toBe('^([01][0-9]|2[0-3]):[0-5][0-9]$');
  });

  it('propagates onChange like a normal input', () => {
    let captured = '';
    render(
      <TimeInput
        aria-label="time"
        onChange={(e) => {
          captured = e.target.value;
        }}
      />,
    );
    const input = screen.getByLabelText('time') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '14:30' } });
    expect(captured).toBe('14:30');
  });
});
