'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import { useAdminSession } from '@/components/admin/session-context'
import { ADMIN_NAV, ADMIN_SETTINGS_NAV, isNavItemActive, type AdminNavItem } from '@/components/admin/nav-items'

function NavLink({ item, onNavigate, badge }: { item: AdminNavItem; onNavigate?: () => void; badge?: number }) {
  const pathname = usePathname()
  const active = isNavItemActive(item, pathname)

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        active
          ? 'bg-brand-500/10 text-brand-300'
          : 'text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-100',
      )}
    >
      {/* Active rail: a quieter signal than a filled pill. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-1.5 left-0 w-0.5 rounded-full transition-colors',
          active ? 'bg-brand-500' : 'bg-transparent',
        )}
      />
      <item.icon className={cn('h-[18px] w-[18px]', active ? 'text-brand-400' : 'text-neutral-500')} />
      <span className="flex-1">{item.label}</span>
      {badge ? (
        <span
          className="min-w-[1.25rem] rounded-full bg-amber-500 px-1.5 py-px text-center text-[11px] font-semibold tabular-nums text-neutral-950"
          title={`${badge} template${badge === 1 ? '' : 's'} waiting for review`}
        >
          {badge}
        </span>
      ) : null}
      {item.notWired ? (
        <span
          className="rounded border border-neutral-700 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-neutral-500"
          title="Not connected to the live server yet"
        >
          Soon
        </span>
      ) : null}
    </Link>
  )
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { me, templateReviews } = useAdminSession()
  return (
    <nav aria-label="Admin" className="space-y-1">
      {ADMIN_NAV.filter((item) => !item.visible || item.visible(me)).map((item) => (
        <NavLink
          key={item.href}
          item={item}
          onNavigate={onNavigate}
          badge={item.href === '/admin/templates' ? (templateReviews?.count ?? 0) : undefined}
        />
      ))}
    </nav>
  )
}

export function SidebarSettingsNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Settings">
      <NavLink item={ADMIN_SETTINGS_NAV} onNavigate={onNavigate} />
    </nav>
  )
}
