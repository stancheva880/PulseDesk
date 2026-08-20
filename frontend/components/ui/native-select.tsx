import * as React from 'react';
import { cn } from '@/lib/utils';

// Plain <select> with the shared field styling. Native on purpose — EPIC-0004
// replaced the Radix select with this.
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = 'NativeSelect';
