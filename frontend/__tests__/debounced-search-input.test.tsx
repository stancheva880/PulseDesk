import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DebouncedSearchInput } from '@/components/ui/debounced-search-input';

// TKT-0093: the request-budget contract, same as chips-combobox and the DTOs' @MaxLength(100).
// Nothing below 2 characters, keystrokes coalesce for 300ms, a value the server would 400 on is
// never applied, and clearing applies immediately.
describe('DebouncedSearchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const onApply = vi.fn();
    render(<DebouncedSearchInput value="" onApply={onApply} placeholder="Search" />);
    return { onApply, input: screen.getByPlaceholderText('Search') };
  }

  it('a 1-character query applies nothing', () => {
    const { onApply, input } = setup();

    fireEvent.change(input, { target: { value: 'a' } });
    vi.advanceTimersByTime(1000);

    expect(onApply).not.toHaveBeenCalled();
  });

  it('keystrokes under 300ms apart coalesce into one apply', () => {
    const { onApply, input } = setup();

    fireEvent.change(input, { target: { value: 'iv' } });
    vi.advanceTimersByTime(200);
    fireEvent.change(input, { target: { value: 'iva' } });
    vi.advanceTimersByTime(200);
    fireEvent.change(input, { target: { value: 'ivan' } });
    expect(onApply).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('ivan');
  });

  it('a query over 100 characters is not applied', () => {
    const { onApply, input } = setup();

    fireEvent.change(input, { target: { value: 'x'.repeat(101) } });
    vi.advanceTimersByTime(1000);

    expect(onApply).not.toHaveBeenCalled();
  });

  it('shrinking below the minimum cancels a pending apply', () => {
    const { onApply, input } = setup();

    fireEvent.change(input, { target: { value: 'iv' } });
    vi.advanceTimersByTime(200);
    fireEvent.change(input, { target: { value: 'i' } });
    vi.advanceTimersByTime(1000);

    expect(onApply).not.toHaveBeenCalled();
  });

  it('clearing applies immediately', () => {
    const { onApply, input } = setup();

    fireEvent.change(input, { target: { value: 'ivan' } });
    vi.advanceTimersByTime(300);
    expect(onApply).toHaveBeenCalledWith('ivan');

    fireEvent.change(input, { target: { value: '' } });

    expect(onApply).toHaveBeenCalledWith('');
    expect(onApply).toHaveBeenCalledTimes(2);
  });
});
