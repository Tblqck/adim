import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

/**
 * Text input. Sunken against a surface (neutral-950 on neutral-900) so form
 * fields read as recessed rather than as another raised card.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'block w-full rounded-lg border bg-neutral-950 px-3.5 text-neutral-100 transition-colors',
        // 44px on mobile keeps the tap target comfortable; text-base avoids
        // iOS Safari zooming the viewport on focus.
        'h-11 text-base sm:h-10 sm:text-sm',
        'placeholder:text-neutral-500',
        'focus:outline-none focus:ring-1',
        invalid
          ? 'border-rose-500/60 focus:border-rose-500 focus:ring-rose-500'
          : 'border-neutral-800 hover:border-neutral-700 focus:border-brand-500 focus:ring-brand-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
})
