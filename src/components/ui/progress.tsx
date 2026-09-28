import { cn } from '@/lib/utils/cn'
import { Icons } from '@/components/ui/icons'

/**
 * Determinate progress bar. Pass `value` as a percentage (0–100).
 */
export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number
  label?: string
  className?: string
}) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium text-neutral-300">{label}</span>
          <span className="tabular-nums text-neutral-500">{Math.round(clamped)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800"
      >
        <div
          className="h-full rounded-full bg-brand-500 transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}

/** Progress with no known completion time. */
export function IndeterminateBar({ className }: { className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Working"
      className={cn('h-1 w-full overflow-hidden rounded-full bg-neutral-800', className)}
    >
      <div className="h-full w-1/3 rounded-full bg-brand-500 animate-indeterminate" />
    </div>
  )
}

export interface Step {
  id: string
  label: string
}

export type StepState = 'complete' | 'current' | 'upcoming'

/**
 * Horizontal step indicator used across the customer verification flow.
 */
export function StepProgress({
  steps,
  currentIndex,
  className,
}: {
  steps: readonly Step[]
  currentIndex: number
  className?: string
}) {
  return (
    <ol className={cn('flex items-center gap-2', className)}>
      {steps.map((step, index) => {
        const state: StepState =
          index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming'
        return (
          <li key={step.id} className="flex flex-1 flex-col gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                'h-1 rounded-full transition-colors',
                state === 'complete' && 'bg-emerald-500/70',
                state === 'current' && 'bg-brand-500',
                state === 'upcoming' && 'bg-neutral-800',
              )}
            />
            <span
              className={cn(
                'flex items-center gap-1 text-[11px] font-medium',
                state === 'complete' && 'text-emerald-400',
                state === 'current' && 'text-brand-400',
                state === 'upcoming' && 'text-neutral-500',
              )}
            >
              {state === 'complete' ? <Icons.Check className="h-3 w-3" /> : null}
              {step.label}
            </span>
            {state === 'current' ? <span className="sr-only">Current step</span> : null}
          </li>
        )
      })}
    </ol>
  )
}
