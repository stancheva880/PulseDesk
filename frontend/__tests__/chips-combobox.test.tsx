import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ChipsCombobox, type ComboboxOption } from '@/components/ui/chips-combobox';

// TKT-0078. The behavioural contract is the WAI-ARIA APG combobox pattern, plus the request
// budget PRD-0011 §7 fixed: one request on focus, nothing under two characters, 300ms coalescing.

const PEOPLE: ComboboxOption[] = [
  { id: 'u-1', label: 'Георги Иванов' },
  { id: 'u-2', label: 'Мария Петрова' },
  { id: 'u-3', label: 'Иван Тодоров' },
];

/** Wraps the controlled component so a test can drive it the way a form does. */
function Harness({
  search,
  initial = [],
  selected = [],
  emptyLabel,
  noMatchesLabel,
}: {
  search: (q: string) => Promise<ComboboxOption[]>;
  initial?: string[];
  selected?: ComboboxOption[];
  emptyLabel?: string;
  noMatchesLabel?: string;
}) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <>
      <ChipsCombobox
        id="people"
        value={value}
        onChange={setValue}
        search={search}
        selected={selected}
        emptyLabel={emptyLabel}
        noMatchesLabel={noMatchesLabel}
      />
      <output data-testid="value">{value.join(',')}</output>
    </>
  );
}

function stubSearch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (q: string) =>
    q.length === 0
      ? PEOPLE
      : PEOPLE.filter((p) => p.label.toLocaleLowerCase().includes(q.toLocaleLowerCase())),
  );
}

const input = () => screen.getByRole('combobox');
const value = () => screen.getByTestId('value').textContent;

describe('ChipsCombobox', () => {
  it('fires exactly one search on focus and lists what came back', async () => {
    const user = userEvent.setup();
    const search = stubSearch();
    render(<Harness search={search} />);

    await user.click(input());

    await screen.findByRole('option', { name: 'Георги Иванов' });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('fires no search for a one-character query', async () => {
    const user = userEvent.setup();
    const search = stubSearch();
    render(<Harness search={search} />);

    await user.click(input());
    await screen.findByRole('option', { name: 'Георги Иванов' });
    search.mockClear();

    await user.type(input(), 'Г');
    await new Promise((r) => setTimeout(r, 500));
    expect(search).not.toHaveBeenCalled();
  });

  it('coalesces fast keystrokes into a single search', async () => {
    const user = userEvent.setup();
    const search = stubSearch();
    render(<Harness search={search} />);

    await user.click(input());
    await screen.findByRole('option', { name: 'Георги Иванов' });
    search.mockClear();

    await user.type(input(), 'Георги');
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('Георги');
  });

  it('carries the APG combobox roles and attributes while open', async () => {
    const user = userEvent.setup();
    render(<Harness search={stubSearch()} />);

    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input()).toHaveAttribute('aria-autocomplete', 'list');

    await user.click(input());
    const first = await screen.findByRole('option', { name: 'Георги Иванов' });

    expect(input()).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true');
    expect(input()).toHaveAttribute('aria-controls', listbox.id);
    expect(first).toHaveAttribute('aria-selected', 'false');
  });

  it('moves the active option with the arrows while focus stays in the input', async () => {
    const user = userEvent.setup();
    render(<Harness search={stubSearch()} />);

    await user.click(input());
    await screen.findByRole('option', { name: 'Георги Иванов' });

    await user.keyboard('{ArrowDown}');
    const firstActive = input().getAttribute('aria-activedescendant');
    expect(firstActive).toBeTruthy();
    expect(input()).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(input().getAttribute('aria-activedescendant')).not.toBe(firstActive);
    expect(input()).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(input().getAttribute('aria-activedescendant')).toBe(firstActive);
  });

  it('adds the active option as a chip on Enter and marks it selected', async () => {
    const user = userEvent.setup();
    render(<Harness search={stubSearch()} />);

    await user.click(input());
    await screen.findByRole('option', { name: 'Георги Иванов' });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(value()).toBe('u-1');
    expect(screen.getByRole('button', { name: /Георги Иванов/ })).toBeInTheDocument();
  });

  it('closes the popup on Escape without selecting anything', async () => {
    const user = userEvent.setup();
    render(<Harness search={stubSearch()} />);

    await user.click(input());
    await screen.findByRole('option', { name: 'Георги Иванов' });
    await user.keyboard('{ArrowDown}{Escape}');

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(value()).toBe('');
  });

  it('removes the last chip on Backspace in an empty input', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        search={stubSearch()}
        initial={['u-1', 'u-2']}
        selected={[PEOPLE[0]!, PEOPLE[1]!]}
      />,
    );

    await user.click(input());
    await user.keyboard('{Backspace}');
    expect(value()).toBe('u-1');

    await user.keyboard('{Backspace}');
    expect(value()).toBe('');
  });

  it('leaves the chips alone when Backspace is pressed with text in the input', async () => {
    const user = userEvent.setup();
    render(<Harness search={stubSearch()} initial={['u-1']} selected={[PEOPLE[0]!]} />);

    await user.click(input());
    await user.type(input(), 'Ге');
    await user.keyboard('{Backspace}');
    expect(value()).toBe('u-1');
  });

  it('removes a chip through its own control', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        search={stubSearch()}
        initial={['u-1', 'u-2']}
        selected={[PEOPLE[0]!, PEOPLE[1]!]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Георги Иванов/ }));
    expect(value()).toBe('u-2');
  });

  it('renders a chip for a selected id even when the search never returns it', async () => {
    const user = userEvent.setup();
    // The roster case from TKT-0079: a member outside the actor's scope is in `selected` but can
    // never come back from a search.
    const search = vi.fn(async () => [] as ComboboxOption[]);
    render(
      <Harness
        search={search}
        initial={['u-hidden']}
        selected={[{ id: 'u-hidden', label: 'Скрит Потребител' }]}
      />,
    );

    expect(screen.getByRole('button', { name: /Скрит Потребител/ })).toBeInTheDocument();
    await user.click(input());
    expect(value()).toBe('u-hidden');
  });

  // TKT-0084: the two empty states are different situations and must not share one sentence.
  // "None available — create one first" is wrong advice when the club is full and the query missed.
  it('shows the nothing-exists message when there is no query', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        search={vi.fn(async () => [] as ComboboxOption[])}
        emptyLabel="Няма налични трениращи"
        noMatchesLabel="Няма съвпадения"
      />,
    );

    await user.click(input());

    expect(await screen.findByText('Няма налични трениращи')).toBeInTheDocument();
    expect(screen.queryByText('Няма съвпадения')).toBeNull();
  });

  it('shows the no-matches message once a query has been typed', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async (q: string) =>
      q.length === 0 ? PEOPLE : ([] as ComboboxOption[]),
    );
    render(
      <Harness
        search={search}
        emptyLabel="Няма налични трениращи"
        noMatchesLabel="Няма съвпадения"
      />,
    );

    await user.click(input());
    await screen.findByRole('option', { name: 'Георги Иванов' });
    await user.type(input(), 'ццц');

    expect(await screen.findByText('Няма съвпадения')).toBeInTheDocument();
    expect(screen.queryByText('Няма налични трениращи')).toBeNull();
  });

  it('does not offer an option that is already selected twice', async () => {
    const user = userEvent.setup();
    render(<Harness search={stubSearch()} />);

    await user.click(input());
    await screen.findByRole('option', { name: 'Георги Иванов' });
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => {
      const listbox = screen.queryByRole('listbox');
      if (listbox) {
        expect(within(listbox).queryByRole('option', { name: 'Георги Иванов' })).toBeNull();
      }
    });
    expect(value()).toBe('u-1');
  });
});
