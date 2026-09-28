import { cn } from '@/lib/utils/cn'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

/** Signed-in identity block at the foot of the sidebar. */
export function AccountCard({ name, role, className }: { name: string; role: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 px-3 py-2', className)}>
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-800 text-[11px] font-semibold text-neutral-200"
      >
        {initials(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{name}</span>
        <span className="block truncate text-xs text-neutral-500">{role}</span>
      </span>
    </div>
  )
}
