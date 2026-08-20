'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Handwritten on purpose. shadcn's multi-select is Popover + Command (cmdk), and EPIC-0004 shed
// frontend dependencies deliberately — see PRD-0011 §7. The contract implemented here is the
// WAI-ARIA APG combobox pattern: role="combobox" on the input, a listbox popup, focus staying in
// the input while aria-activedescendant tracks the active option.

export interface ComboboxOption {
  id: string;
  label: string;
}

interface ChipsComboboxProps {
  id: string;
  /** Selected ids. Controlled — the parent owns them (react-hook-form via Controller). */
  value: string[];
  onChange: (ids: string[]) => void;
  /** Called with '' on focus, then with the typed query. Debounced by the component. */
  search: (query: string) => Promise<ComboboxOption[]>;
  /**
   * Labels for ids the search may never return — a saved roster member outside the actor's
   * location scope, for instance. Chips render from here first, then from what search learned.
   */
  selected?: ComboboxOption[];
  placeholder?: string;
  /** Shown when nothing exists to pick yet — e.g. "No trainees available, create one first". */
  emptyLabel?: string;
  /** Shown when a query returned nothing. Falls back to `emptyLabel` when not given. */
  noMatchesLabel?: string;
  minChars?: number;
  debounceMs?: number;
  invalid?: boolean;
}

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

export function ChipsCombobox({
  id,
  value,
  onChange,
  search,
  selected = [],
  placeholder,
  emptyLabel,
  noMatchesLabel,
  minChars = MIN_CHARS,
  debounceMs = DEBOUNCE_MS,
  invalid = false,
}: ChipsComboboxProps) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [results, setResults] = React.useState<ComboboxOption[]>([]);
  const [active, setActive] = React.useState(-1);
  const listboxId = `${id}-listbox`;

  // Labels come from two places: what the parent seeded (derived, never copied into state) and
  // what a search has shown us since (kept, so a chip does not lose its name when the results
  // it came from are replaced).
  const [learned, setLearned] = React.useState<Record<string, string>>({});
  const known = React.useMemo(
    () => ({ ...Object.fromEntries(selected.map((o) => [o.id, o.label])), ...learned }),
    [selected, learned],
  );

  // One request on focus (empty query), nothing between 1 char and minChars, debounced above it.
  // The request budget is shared with the whole app through the 100 req/60s throttle.
  React.useEffect(() => {
    if (!open) return;
    if (query.length > 0 && query.length < minChars) return;
    let cancelled = false;
    const run = () => {
      void search(query).then((found) => {
        if (cancelled) return;
        setResults(found);
        setLearned((prev) => {
          const next = { ...prev };
          for (const o of found) next[o.id] = o.label;
          return next;
        });
      });
    };
    if (query.length === 0) {
      run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(run, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, minChars, debounceMs, search]);

  const offered = results.filter((o) => !value.includes(o.id));

  // Two different situations, two different sentences. `emptyLabel` is written for "there are none
  // yet, go create one", which is wrong advice when the club is full and the query simply missed.
  // Keyed off `results`, not `offered`: `offered` also empties when every option is already picked,
  // and that is not a "create one first" case either — it falls into the no-matches branch.
  const emptyMessage =
    results.length === 0 && query.trim() === '' ? emptyLabel : (noMatchesLabel ?? emptyLabel);

  const add = (option: ComboboxOption) => {
    if (value.includes(option.id)) return;
    setLearned((prev) => ({ ...prev, [option.id]: option.label }));
    onChange([...value, option.id]);
    setQuery('');
    setActive(-1);
  };
  const remove = (removed: string) => onChange(value.filter((v) => v !== removed));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (offered.length === 0 ? -1 : Math.min(i + 1, offered.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const option = offered[active];
      if (option) add(option);
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === 'Backspace' && query.length === 0 && value.length > 0) {
      remove(value[value.length - 1]!);
    }
  };

  return (
    <div className="space-y-1.5">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((selectedId) => (
            <li key={selectedId}>
              <button
                type="button"
                onClick={() => remove(selectedId)}
                className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs text-secondary-foreground hover:bg-secondary/80"
              >
                {known[selectedId] ?? selectedId}
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active >= 0 && offered[active] ? `${id}-opt-${offered[active]!.id}` : undefined
          }
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Let a click on an option land before the popup goes away.
            setTimeout(() => setOpen(false), 120);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
            'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            invalid && 'border-destructive',
          )}
        />
        {open ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md"
          >
            {offered.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyMessage}</li>
            ) : (
              offered.map((option, i) => (
                <li
                  key={option.id}
                  id={`${id}-opt-${option.id}`}
                  role="option"
                  aria-selected={value.includes(option.id)}
                  onMouseDown={(e) => {
                    // mousedown, not click: blur would close the popup first.
                    e.preventDefault();
                    add(option);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'cursor-pointer rounded px-2 py-1.5 text-sm',
                    i === active ? 'bg-accent text-accent-foreground' : undefined,
                  )}
                >
                  {option.label}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
