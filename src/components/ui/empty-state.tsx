import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'
import type { IconComponent } from '@/components/ui/icons'

/**
 * Empty state.
 *
 * Used wherever a collection has no rows yet. It states the fact and explains
 * what will cause content to appear — it never fabricates sample data.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: IconComponent
  title: string
  description: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-16 text-center sm:py-20',
        className,
      )}
    >
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950">
        <Icon className="h-5 w-5 text-neutral-500" />
      </div>
      <h3 className="text-base font-medium text-white">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-neutral-400">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  )
}
