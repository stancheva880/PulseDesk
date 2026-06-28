import { cn } from '@/lib/utils';

/**
 * The PulseDesk gradient "P" logo mark. Decorative (aria-hidden) — pair it with the
 * `app.name` wordmark text for the accessible label. Size via the `className` prop
 * (e.g. `h-10 w-10 text-lg`).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid place-items-center rounded-xl bg-gradient-to-br from-primary to-[hsl(30_100%_52%)] font-bold leading-none text-primary-foreground shadow-[0_8px_24px_-6px_hsl(20_100%_48%_/_0.45)]',
        className,
      )}
    >
      P
    </span>
  );
}
