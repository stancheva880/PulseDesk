'use client';

import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';

// A date filter that can be emptied again. No browser offers a dependable clear control for
// type="date" — Chrome shows only the calendar indicator — and '' is exactly what callers treat
// as "bound omitted". Owns its own `relative` wrapper, unlike PasswordInput, which delegates
// that to the caller: here the Label sits in the same block and the ✕ would centre against the
// pair. Extracted from fees-chart.tsx for the sessions filter (TKT-0094) — importing it from the
// chart file would have dragged Recharts into every consumer's bundle.
export function ClearableDateInput({
  id,
  value,
  onChange,
  clearLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  clearLabel: string;
}) {
  return (
    <div className="relative">
      {/* pr-14 keeps a typed date clear of both controls; the ✕ sits at right-7 so the
          browser's own calendar indicator keeps the edge it reserves. */}
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-14"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          className="absolute right-7 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
