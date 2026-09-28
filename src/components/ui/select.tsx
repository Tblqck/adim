import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils/cn'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

/**
 * Native select with a custom chevron. Native is intentional: it gives correct
 * keyboard and screen-reader behaviour and the platform picker on mobile.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid = false, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'block w-full appearance-none rounded-lg border bg-neutral-950 pl-3.5 pr-10 text-neutral-100 transition-colors',
          'h-11 text-base sm:h-10 sm:text-sm',
          'focus:outline-none focus:ring-1',
          invalid
            ? 'border-rose-500/60 focus:border-rose-500 focus:ring-rose-500'
            : 'border-neutral-800 hover:border-neutral-700 focus:border-brand-500 focus:ring-brand-500',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
})
