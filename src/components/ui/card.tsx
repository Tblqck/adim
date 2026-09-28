import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * Surfaces.
 *
 * One elevation step only — neutral-900 on the neutral-950 canvas, separated
 * by a neutral-800 hairline. Depth comes from the hairline, not from shadow.
 */
export function Card({
  className,
  children,
  interactive = false,
}: {
  className?: string
  children: ReactNode
  interactive?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-neutral-800 bg-surface',
        interactive &&
          'transition-colors hover:border-neutral-700 focus-within:border-brand-500/50',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 px-4 py-4 sm:px-5',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-white">{title}</h2>
        {description ? <p className="mt-1 text-sm text-neutral-400">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-4 py-4 sm:px-5 sm:py-5', className)}>{children}</div>
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-3 border-t border-neutral-800 bg-neutral-950/40 px-4 py-3 sm:px-5',
        className,
      )}
    >
      {children}
    </div>
  )
}
