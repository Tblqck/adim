import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * Label + hint + error scaffolding shared by every form control, so validation
 * messaging looks and behaves identically across the product.
 *
 * The control passed as `children` is cloned with the matching `id` and
 * `aria-describedby`, so accessibility wiring cannot drift from the markup.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  required?: boolean
  className?: string
  children: ReactNode
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined
  const errorId = error ? `${htmlFor}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  const only = Children.only(children)
  const control = isValidElement(only)
    ? cloneElement(only as ReactElement<Record<string, unknown>>, {
        id: htmlFor,
        'aria-describedby': describedBy,
        ...(error ? { invalid: true } : {}),
      })
    : only

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-neutral-300">
        {label}
        {required ? <span className="ml-1 text-brand-400">*</span> : null}
      </label>

      {control}

      {error ? (
        <p id={errorId} className="text-sm text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-neutral-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
