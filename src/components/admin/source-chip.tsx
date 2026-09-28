import { Icons, type IconComponent } from '@/components/ui'
import { cn } from '@/lib/utils/cn'

/**
 * Where a verification came from, in the white-label list's Source-chip
 * style. The live server records how the person was captured
 * (verification_results.verification_mode), not which channel sent it — a
 * Generate-link capture and a direct API call look the same once stored.
 */
const SOURCE: Record<number, { label: string; title: string; icon: IconComponent; tone: string }> = {
  1: {
    label: 'Selfie',
    title: 'ID document plus a single selfie.',
    icon: Icons.Camera,
    tone: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
  2: {
    label: 'Holding photo',
    title: 'ID document plus a photo of the person holding it.',
    icon: Icons.Image,
    tone: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  },
  3: {
    label: 'Liveness',
    title: 'ID document plus live face frames checked for liveness.',
    icon: Icons.Smartphone,
    tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
}

export function SourceChip({ mode, className }: { mode: number | null | undefined; className?: string }) {
  const source = mode == null ? undefined : SOURCE[mode]
  if (!source) return <span className={cn('text-neutral-500', className)}>—</span>
  return (
    <span
      title={source.title}
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium', source.tone, className)}
    >
      <source.icon className="h-3.5 w-3.5" />
      {source.label}
    </span>
  )
}
