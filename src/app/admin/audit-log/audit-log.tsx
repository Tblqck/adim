'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, EmptyState, Icons, Input, type IconComponent } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { Notice, TabStrip } from '@/components/admin/kit'
import { useAdminSession } from '@/components/admin/session-context'
import { apiJson, messageOf } from '@/lib/api'
import type { AuditCategory, AuditEvent, AuditPage } from '@/lib/types'
import { cn } from '@/lib/utils/cn'

type Tab = 'all' | AuditCategory

const TABS: { key: Tab; label: string; backOffice?: boolean }[] = [
  { key: 'all', label: 'All activity' },
  { key: 'access', label: 'Sign-ins' },
  { key: 'verifications', label: 'Verifications' },
  { key: 'links', label: 'Links' },
  { key: 'screening', label: 'Screening' },
  { key: 'account', label: 'Account' },
  { key: 'templates', label: 'Templates', backOffice: true },
  { key: 'security', label: 'Security', backOffice: true },
]

const CATEGORY_ICON: Record<AuditCategory, IconComponent> = {
  access: Icons.Lock,
  verifications: Icons.ClipboardList,
  links: Icons.Link,
  screening: Icons.ShieldCheck,
  account: Icons.Users,
  templates: Icons.CreditCard,
  security: Icons.AlertTriangle,
}

const OUTCOME_STYLE: Record<'ok' | 'warning' | 'error' | 'none', string> = {
  ok: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/25',
  warning: 'bg-amber-500/10 text-amber-300 ring-amber-500/25',
  error: 'bg-red-500/10 text-red-400 ring-red-500/25',
  none: 'bg-neutral-800/80 text-neutral-400 ring-neutral-700/60',
}

const PAGE_SIZE = 50

function actorLabel(e: AuditEvent): string {
  if (e.actor_type === 'system') return 'System'
  if (e.actor_type === 'applicant') return e.actor ? `Applicant · ${e.actor}` : 'Applicant'
  if (!e.actor) return ''
  return e.actor === 'Super Admin' ? 'Back office' : e.actor
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function targetHref(e: AuditEvent): string | null {
  if (e.target_type === 'verification' && e.target_id && e.action !== 'verification.deleted') return `/admin/verifications/${e.target_id}`
  if (e.target_type === 'link') return '/admin/links'
  if (e.target_type === 'template' && e.target_id && e.action !== 'template.deleted') return `/admin/templates/editor/${e.target_id}`
  return null
}

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function exportCsv(items: AuditEvent[], firmName: (id: number | null) => string) {
  const rows = [
    ['Time (UTC)', 'Category', 'Action', 'Who', 'Firm', 'What', 'Outcome', 'IP'],
    ...items.map((e) => [e.at, e.category, e.action, actorLabel(e), firmName(e.firm_id), e.summary, e.outcome, e.ip]),
  ]
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Who did what, and when. The server merges its audit table with the
 * records it already keeps (screens, checks, verifications, links) — see
 * production/audit_log.py — so the log reaches back further than the audit
 * table itself.
 */
export function AuditLog() {
  const { isSuperAdmin, firmId, firms } = useAdminSession()
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [items, setItems] = useState<AuditEvent[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [recording, setRecording] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const request = useRef(0)

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 350)
    return () => clearTimeout(timer)
  }, [search])

  const query = useCallback(
    (before?: string) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
      if (tab !== 'all') params.set('category', tab)
      if (q) params.set('q', q)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (isSuperAdmin && firmId) params.set('firm_id', String(firmId))
      if (before) params.set('before', before)
      return `/audit?${params}`
    },
    [tab, q, dateFrom, dateTo, isSuperAdmin, firmId],
  )

  const load = useCallback(async () => {
    const id = ++request.current
    setError(null)
    setItems(null)
    try {
      const r = await apiJson<AuditPage>(query(), {}, 'Could not load the audit log')
      if (id !== request.current) return
      if (!r.ok) {
        setError(
          r.status === 404
            ? 'The server does not have the audit log yet.'
            : r.status === 403
              ? 'Only your firm’s admin, or team members allowed to manage logins, can see the audit log.'
              : r.detail,
        )
        setItems([])
        return
      }
      setItems(r.data.items)
      setNext(r.data.next_before)
      setRecording(r.data.recording)
    } catch (err) {
      if (id === request.current) setError(messageOf(err))
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  async function loadMore() {
    if (!next) return
    const id = request.current
    setLoadingMore(true)
    try {
      const r = await apiJson<AuditPage>(query(next), {}, 'Could not load more')
      if (id !== request.current) return
      if (r.ok) {
        setItems((prev) => {
          const seen = new Set((prev ?? []).map((e) => e.id))
          return [...(prev ?? []), ...r.data.items.filter((e) => !seen.has(e.id))]
        })
        setNext(r.data.next_before)
      } else setError(r.detail)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setLoadingMore(false)
    }
  }

  const firmName = useCallback((id: number | null) => (id == null ? '' : (firms.find((f) => f.id === id)?.name ?? `Firm #${id}`)), [firms])
  const showFirm = isSuperAdmin && !firmId
  const hasFilters = !!(search || dateFrom || dateTo)

  const groups: { day: string; events: AuditEvent[] }[] = []
  for (const e of items ?? []) {
    const day = dayLabel(e.at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.events.push(e)
    else groups.push({ day, events: [e] })
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Audit log"
        description="Who did what, and when: sign-ins, reviews, screens, document checks, links, deletions and account changes."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void load()}>
              <Icons.Refresh className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="secondary" disabled={!items?.length} onClick={() => items && exportCsv(items, firmName)}>
              <Icons.ArrowRight className="h-4 w-4 rotate-90" />
              Export CSV
            </Button>
          </div>
        }
      />

      {!recording ? (
        <Notice tone="warning">
          {isSuperAdmin ? (
            <>
              <strong className="font-medium text-amber-100">Sign-ins, reviews and account changes are not being recorded yet.</strong> The server
              is ready; the database needs its audit table (<code className="font-mono">audit_events</code>, Migration 2026-09a in{' '}
              <code className="font-mono">db/schema.sql</code>, run once in the Supabase SQL editor). Until then this log shows what the server
              already keeps: screens, document checks, verifications received, links and recycle-bin moves.
            </>
          ) : (
            <>Some actions (sign-ins, reviews, account changes) are not recorded yet. Screens, document checks, verifications and links are listed.</>
          )}
        </Notice>
      ) : null}

      <TabStrip
        label="Activity type"
        className="border-b border-neutral-800"
        active={tab}
        onSelect={setTab}
        tabs={TABS.filter((t) => !t.backOffice || isSuperAdmin).map((t) => ({ key: t.key, label: t.label }))}
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 p-4 sm:px-5">
          <div className="relative min-w-0 flex-1 basis-64">
            <Icons.Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <Input
              value={search}
              placeholder="Search who, person, company, reference…"
              aria-label="Search"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Input type="date" aria-label="From" className="min-w-0 flex-1 sm:w-40 sm:flex-none" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span className="text-neutral-600">–</span>
            <Input type="date" aria-label="To" className="min-w-0 flex-1 sm:w-40 sm:flex-none" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          {hasFilters ? (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch('')
                setDateFrom('')
                setDateTo('')
              }}
            >
              <Icons.Close className="h-4 w-4" />
              Clear
            </Button>
          ) : null}
        </div>

        {error ? (
          <div className="p-4 sm:px-5">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : null}

        {items === null && !error ? (
          <ul className="divide-y divide-neutral-800/60" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <span className="h-8 w-8 animate-pulse rounded-lg bg-neutral-800" />
                <span className="h-3 flex-1 animate-pulse rounded bg-neutral-800" />
                <span className="h-3 w-12 animate-pulse rounded bg-neutral-800" />
              </li>
            ))}
          </ul>
        ) : items && items.length === 0 && !error ? (
          <EmptyState
            icon={Icons.History}
            title={hasFilters || tab !== 'all' ? 'Nothing matches these filters.' : 'No activity yet.'}
            description={hasFilters || tab !== 'all' ? 'Try another type, a wider date range or a shorter search.' : 'Actions taken in the dashboard appear here.'}
          />
        ) : (
          <div>
            {groups.map((group) => (
              <section key={group.day}>
                <h2 className="sticky top-0 z-[1] border-b border-neutral-800 bg-neutral-900/95 px-4 py-2 text-xs font-medium text-neutral-400 backdrop-blur sm:px-5">
                  {group.day}
                </h2>
                <ul className="divide-y divide-neutral-800/60">
                  {group.events.map((e) => (
                    <AuditRow key={e.id} e={e} firm={showFirm ? firmName(e.firm_id) : ''} />
                  ))}
                </ul>
              </section>
            ))}
            {next ? (
              <div className="flex justify-center border-t border-neutral-800 p-4">
                <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
                  Load older activity
                </Button>
              </div>
            ) : items?.length ? (
              <p className="border-t border-neutral-800 p-4 text-center text-xs text-neutral-500">That is everything for these filters.</p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  )
}

function AuditRow({ e, firm }: { e: AuditEvent; firm: string }) {
  const Icon = CATEGORY_ICON[e.category] ?? Icons.History
  const who = actorLabel(e)
  const href = targetHref(e)
  const summary = e.summary || e.action
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', OUTCOME_STYLE[e.outcome ?? 'none'])}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-neutral-100">
          {href ? (
            <Link href={href} className="hover:text-brand-300">
              {summary}
            </Link>
          ) : (
            summary
          )}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-neutral-500">
          {who ? (
            <span className={cn(e.actor_type === 'user' ? 'text-neutral-300' : 'text-neutral-400')}>{who}</span>
          ) : (
            <span className="italic" title="This record comes from before sign-ins and actions were recorded, or from a table that does not keep who did it.">
              Who: not recorded
            </span>
          )}
          {firm ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{firm}</span>
            </>
          ) : null}
          {e.ip ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{e.ip}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span className="font-mono text-neutral-600">{e.action}</span>
        </p>
      </div>
      <time dateTime={e.at} title={new Date(e.at).toLocaleString()} className="shrink-0 pt-0.5 text-xs tabular-nums text-neutral-500">
        {timeLabel(e.at)}
      </time>
    </li>
  )
}
