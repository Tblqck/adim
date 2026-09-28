import { cn } from '@/lib/utils/cn'
import { Icons } from '@/components/ui/icons'

export function Spinner({ className }: { className?: string }) {
  return (
    <Icons.Spinner className={cn('h-5 w-5 animate-spin text-brand-400', className)} role="status" />
  )
}

/** Placeholder block for content that is still loading. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-neutral-800/70', className)}
    />
  )
}

/** Centred loading state for a full page or panel. */
export function LoadingState({
  title = 'Loading',
  description,
  className,
}: {
  title?: string
  description?: string
  className?: string
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}
    >
      <Spinner className="h-6 w-6" />
      <p className="text-sm font-medium text-neutral-200">{title}</p>
      {description ? <p className="max-w-sm text-sm text-neutral-500">{description}</p> : null}
    </div>
  )
}

/** Skeleton shaped like a data table, used by admin route `loading.tsx` files. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4 sm:p-5">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="hidden h-4 w-40 sm:block" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  )
}
