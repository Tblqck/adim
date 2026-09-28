'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiJson, NotAuthenticatedError } from '@/lib/api'
import type { Firm, Me } from '@/lib/types'

/**
 * Who is signed in, resolved from the live API's /me — the same source of
 * truth the server uses to scope every request. Role checks here only decide
 * what to *show*; the API server enforces them regardless.
 *
 * A super-admin sees every firm by default and can narrow the whole
 * dashboard to one (the old dashboard's per-page "Firm" dropdown, lifted into
 * the sidebar so the choice follows you between pages).
 */

interface AdminSession {
  me: Me
  isSuperAdmin: boolean
  /** Can create and manage employee logins and the firm API key. */
  canManageUsers: boolean
  firms: Firm[]
  /** Super-admin's firm filter; null = all firms. Firm sessions: their own firm. */
  firmId: number | null
  setFirmId: (id: number | null) => void
  refreshFirms: () => Promise<void>
  /**
   * Template drafts waiting for the back office — the notification behind the
   * sidebar badge and the Overview banner. null: not the back office, or the
   * template service is not connected yet.
   */
  templateReviews: { count: number; newest: string | null } | null
  refreshTemplateReviews: () => Promise<void>
}

const SessionContext = createContext<AdminSession | null>(null)

const FIRM_KEY = 'collation.firmFilter'

export function useAdminSession(): AdminSession {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useAdminSession must be used inside <SessionProvider>.')
  return context
}

/** `?firm_id=` for the super-admin's current filter, '' otherwise. */
export function useFirmQuery(): string {
  const { isSuperAdmin, firmId } = useAdminSession()
  return isSuperAdmin && firmId ? `firm_id=${firmId}` : ''
}

type LoadState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; me: Me }

export function SessionProvider({
  children,
  fallback,
  renderError,
}: {
  children: ReactNode
  fallback: ReactNode
  renderError: (message: string, retry: () => void) => ReactNode
}) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [firms, setFirms] = useState<Firm[]>([])
  const [firmId, setFirmIdState] = useState<number | null>(null)
  const [templateReviews, setTemplateReviews] = useState<AdminSession['templateReviews']>(null)

  const loadMe = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const result = await apiJson<Me>('/me', {}, 'Could not load your account')
      if (result.ok) setState({ kind: 'ready', me: result.data })
      else setState({ kind: 'error', message: result.detail })
    } catch (error) {
      if (error instanceof NotAuthenticatedError) return
      setState({ kind: 'error', message: 'The verification server could not be reached.' })
    }
  }, [])

  const isSuperAdmin = state.kind === 'ready' && state.me.super_admin

  const refreshFirms = useCallback(async () => {
    try {
      const result = await apiJson<{ items: Firm[] }>('/firms')
      if (result.ok) setFirms(result.data.items ?? [])
    } catch {
      // The picker simply stays empty; every page still works on "all firms".
    }
  }, [])

  useEffect(() => {
    void loadMe()
  }, [loadMe])

  const refreshTemplateReviews = useCallback(async () => {
    try {
      const result = await apiJson<{ items: { created_at: string }[] }>('/templates?status=draft')
      if (!result.ok) {
        setTemplateReviews(null)
        return
      }
      const items = result.data.items ?? []
      const newest = items.reduce<string | null>((max, t) => (!max || t.created_at > max ? t.created_at : max), null)
      setTemplateReviews({ count: items.length, newest })
    } catch {
      // Keep the last known count; the next poll tries again.
    }
  }, [])

  // New drafts arrive from the pipeline at any time, so the count is polled
  // (once a minute) rather than read once at sign-in.
  useEffect(() => {
    if (!isSuperAdmin) return
    void refreshTemplateReviews()
    const timer = setInterval(() => void refreshTemplateReviews(), 60_000)
    return () => clearInterval(timer)
  }, [isSuperAdmin, refreshTemplateReviews])

  useEffect(() => {
    if (!isSuperAdmin) return
    void refreshFirms()
    try {
      const saved = Number(localStorage.getItem(FIRM_KEY))
      if (saved > 0) setFirmIdState(saved)
    } catch {
      // Storage unavailable — start on "all firms".
    }
  }, [isSuperAdmin, refreshFirms])

  const setFirmId = useCallback((id: number | null) => {
    setFirmIdState(id)
    try {
      if (id) localStorage.setItem(FIRM_KEY, String(id))
      else localStorage.removeItem(FIRM_KEY)
    } catch {
      // Not remembered across reloads, but still applied now.
    }
  }, [])

  const value = useMemo<AdminSession | null>(() => {
    if (state.kind !== 'ready') return null
    // The server names the platform-level login "Super Admin"; this product
    // calls that role the back office.
    const me = state.me.super_admin ? { ...state.me, display_name: 'Back office' } : state.me
    return {
      me,
      isSuperAdmin: me.super_admin,
      canManageUsers: me.super_admin || !!me.can_create_users,
      firms,
      firmId: me.super_admin ? firmId : (me.firm_id ?? null),
      setFirmId,
      refreshFirms,
      templateReviews: me.super_admin ? templateReviews : null,
      refreshTemplateReviews,
    }
  }, [state, firms, firmId, setFirmId, refreshFirms, templateReviews, refreshTemplateReviews])

  if (state.kind === 'loading') return <>{fallback}</>
  if (state.kind === 'error') return <>{renderError(state.message, () => void loadMe())}</>
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
