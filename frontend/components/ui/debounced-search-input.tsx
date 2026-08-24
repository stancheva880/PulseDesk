'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';

// TKT-0093: the list-search request contract, mirrored from chips-combobox.tsx and the DTOs'
// @MaxLength(100): nothing below 2 characters, keystrokes coalesce for 300ms, and a value the
// server would 400 on is never applied. The request budget is shared with the whole app through
// the 100 req/60s throttle (ADR-0002), so these are correctness numbers, not preferences.
const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;
const MAX_CHARS = 100;

interface DebouncedSearchInputProps {
  id?: string;
  /** The applied query — seeds the draft; the parent updates it only through onApply. */
  value: string;
  onApply: (query: string) => void;
  placeholder: string;
}

export function DebouncedSearchInput({
  id,
  value,
  onApply,
  placeholder,
}: DebouncedSearchInputProps) {
  const [draft, setDraft] = React.useState(value);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // All the logic lives in the change handler (the TKT-0094 shape) — no state-syncing effects.
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // maxLength stops a browser earlier; this guard is what a programmatic change hits.
    if (next.length > MAX_CHARS) return;
    if (next.length > 0 && next.length < MIN_CHARS) return;
    if (next.length === 0) {
      onApply('');
      return;
    }
    timer.current = setTimeout(() => onApply(next), DEBOUNCE_MS);
  };

  return (
    <Input
      id={id}
      type="search"
      maxLength={MAX_CHARS}
      value={draft}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={placeholder}
    />
  );
}
