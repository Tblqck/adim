import { cn } from '@/lib/utils/cn'

/**
 * Status vocabulary.
 *
 * These tones are the product's only use of colour-as-meaning. Keep the set
 * closed — a new status should map onto an existing tone rather than
 * introducing a new hue.
 */
export type StatusTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'muted'

const TONE: Record<StatusTone, string> = {
  neutral: 'bg-neutral-500/10 text-neutral-300 border-neutral-500/25',
  brand: 'bg-brand-500/10 text-brand-400 border-brand-500/25',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  danger: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
  muted: 'bg-neutral-800/60 text-neutral-500 border-neutral-700',
}

export function StatusBadge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode
  tone?: StatusTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONE[tone],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {children}
    </span>
  )
}

/** Verification lifecycle statuses (see prisma `VerificationStatus`). */
export const VERIFICATION_STATUS_TONE = {
  CREATED: 'neutral',
  STARTED: 'brand',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'muted',
} as const satisfies Record<string, StatusTone>

export const VERIFICATION_STATUS_LABEL = {
  CREATED: 'Created',
  STARTED: 'Started',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
} as const satisfies Record<string, string>
