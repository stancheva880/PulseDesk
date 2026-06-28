import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function ControlledHarness({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('a');
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    >
      <SelectTrigger aria-label="fruit" className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Apple</SelectItem>
        <SelectItem value="b">Banana</SelectItem>
        <SelectItem value="c">Cherry</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe('Select primitive', () => {
  it('renders the controlled value in the trigger', async () => {
    render(<ControlledHarness onChange={() => undefined} />);
    expect(await screen.findByRole('combobox', { name: 'fruit' })).toHaveTextContent('Apple');
  });

  it('opens, lists options, and fires onValueChange when one is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ControlledHarness onChange={onChange} />);

    await user.click(await screen.findByRole('combobox', { name: 'fruit' }));
    const banana = await screen.findByRole('option', { name: 'Banana' });
    await user.click(banana);

    expect(onChange).toHaveBeenCalledWith('b');
    await vi.waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'fruit' })).toHaveTextContent('Banana'),
    );
  });
});
