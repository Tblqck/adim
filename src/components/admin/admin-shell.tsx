'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import { Button, Icons, LoadingState, Logo, ToastProvider } from '@/components/ui'
import { SidebarNav, SidebarSettingsNav } from '@/components/admin/sidebar-nav'
import { AccountCard } from '@/components/admin/account-card'
import { SignOutButton } from '@/components/admin/sign-out-button'
import { ownsPageChrome, usesWideLayout } from '@/components/admin/nav-items'
import { SessionProvider, useAdminSession } from '@/components/admin/session-context'

/**
 * The firm block under the logo. A firm session shows its own firm; a
 * super-admin gets the firm filter every page reads (all firms by default).
 */
function FirmBlock() {
  const { me, isSuperAdmin, firms, firmId, setFirmId } = useAdminSession()
  const live = firms.filter((firm) => !firm.deleted_at)

  if (!isSuperAdmin) {
    const name = me.firm_name || me.firm_slug || 'Your firm'
    return (
      <div className="border-b border-neutral-800 px-5 py-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Firm</p>
        <p className="mt-1 truncate text-sm font-medium text-neutral-200" title={name}>
          {name}
        </p>
      </div>
    )
  }

  return (
    <div className="border-b border-neutral-800 px-5 py-3.5">
      <label
        htmlFor="firm-filter"
        className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500"
      >
        Viewing firm
      </label>
      <select
        id="firm-filter"
        value={firmId ?? ''}
        onChange={(event) => setFirmId(event.target.value ? Number(event.target.value) : null)}
        className="mt-1.5 block h-9 w-full appearance-none rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 hover:border-neutral-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        <option value="">All firms</option>
        {live.map((firm) => (
          <option key={firm.id} value={firm.id}>
            {firm.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function roleOf(me: ReturnType<typeof useAdminSession>['me']): string {
  if (me.super_admin) return 'Back office'
  if (me.is_head_admin) return 'Firm head admin'
  return me.can_create_users ? 'Employee · manages users' : 'Employee'
}

function Shell({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pathname = usePathname()
  const { me } = useAdminSession()
  // A page that renders its own persistent header (the verification review)
  // needs the full width of the content column; the shell steps back.
  const fullBleed = ownsPageChrome(pathname)
  const wide = usesWideLayout(pathname)

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
    }
  }, [drawerOpen])

  const sidebarContent = (
    <>
      <div className="flex h-16 shrink-0 items-center border-b border-neutral-800 px-5">
        <Logo size="md" />
      </div>

      <FirmBlock />

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <SidebarNav />
      </div>

      <div className="shrink-0 space-y-1 border-t border-neutral-800 px-3 py-3">
        <SidebarSettingsNav />
        <SignOutButton />
        <div className="mt-2 border-t border-neutral-800 pt-2">
          <AccountCard name={me.display_name || me.firm_slug || 'Admin'} role={roleOf(me)} />
        </div>
      </div>
    </>
  )

  return (
    <div className="flex min-h-[100dvh] bg-canvas">
      <a href="#admin-content" className="skip-link">
        Skip to content
      </a>

      {/* Persistent sidebar (md and up) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-neutral-800 bg-surface md:flex">
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[17rem] max-w-[85vw] flex-col border-r border-neutral-800 bg-surface shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Icons.Close className="h-4 w-4" />
            </button>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-neutral-800 bg-surface/95 px-4 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="-ml-1.5 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Icons.Menu className="h-5 w-5" />
          </button>
          <Logo size="sm" />
        </header>

        <main
          id="admin-content"
          className={cn(
            'flex-1',
            fullBleed
              ? 'w-full min-w-0'
              : cn('mx-auto w-full px-4 py-6 sm:px-6 md:px-8 md:py-9', wide ? 'max-w-[1760px]' : 'max-w-6xl'),
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * Admin chrome: a persistent sidebar from `md` up, a slide-over drawer below
 * it. Nothing renders until /me answers — a 401 there sends the visitor to
 * sign in before any page can flash.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SessionProvider
        fallback={<LoadingState className="min-h-[100dvh]" title="Loading your dashboard" />}
        renderError={(message, retry) => (
          <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
            <Icons.AlertTriangle className="h-6 w-6 text-amber-400" />
            <p className="max-w-sm text-sm text-neutral-300">{message}</p>
            <Button variant="secondary" onClick={retry}>
              Try again
            </Button>
          </div>
        )}
      >
        <Shell>{children}</Shell>
      </SessionProvider>
    </ToastProvider>
  )
}
