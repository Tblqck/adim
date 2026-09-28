'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button, Card, CardHeader, EmptyState, Icons, Skeleton, StatusBadge } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { Notice } from '@/components/admin/kit'
import { useAdminSession } from '@/components/admin/session-context'
import { apiJson, messageOf } from '@/lib/api'
import { docTypeLabel, fmtDate } from '@/lib/format'
import { decisionOf, listFinding } from '@/lib/assess'
import type { LinkSession, Paged, VerificationRow } from '@/lib/types'
import { cn } from '@/lib/utils/cn'
import { rowName, useResolvedNames } from '@/lib/identity'

interface Stats {
  total: number
  verified: number
  notVerified: number
  recent: VerificationRow[]
  links: { open: number; opened: number; submitted: number } | null
}

/**
 * Every number here is a count the live API returns — the `total` of a
 * filtered /verifications query — and each tile links to the list that
 * holds the items behind it.
 */
async function loadStats(firmQuery: string): Promise<Stats> {
  const q = (extra: string) => `/verifications?page=1&page_size=${extra ? 1 : 6}${extra}${firmQuery ? `&${firmQuery}` : ''}`
  const [all, verified, notVerified, links] = await Promise.all([
    apiJson<Paged<VerificationRow>>(q(''), {}, 'Could not load verifications'),
    apiJson<Paged<VerificationRow>>(q('&verified=true')),
    apiJson<Paged<VerificationRow>>(q('&verified=false')),
    apiJson<{ items: LinkSession[] }>(`/sessions${firmQuery ? `?${firmQuery}` : ''}`).catch(() => null),
  ])
  if (!all.ok) throw new Error(all.detail)

  let linkStats: Stats['links'] = null
  if (links && links.ok) {
    const now = Date.now()
    const live = links.data.items.filter((l) => !l.deleted_at)
    linkStats = {
      submitted: live.filter((l) => l.status === 'used').length,
      opened: live.filter((l) => l.status !== 'used' && l.opened_at && new Date(l.expires_at).getTime() > now).length,
      open: live.filter((l) => l.status !== 'used' && !l.opened_at && new Date(l.expires_at).getTime() > now).length,
    }
  }

  return {
    total: all.data.total,
    verified: verified.ok ? verified.data.total : 0,
    notVerified: notVerified.ok ? notVerified.data.total : 0,
    recent: all.data.items ?? [],
    links: linkStats,
  }
}

function Tile({ label, value, href, accent }: { label: string; value: number | null; href: string; accent?: string }) {
  return (
    <Link href={href} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
      <Card interactive className="h-full px-4 py-4">
        <p className="text-xs font-medium text-neutral-400">{label}</p>
        {value === null ? (
          <Skeleton className="mt-2 h-7 w-12" />
        ) : (
          <p className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight text-white', accent)}>{value}</p>
        )}
      </Card>
    </Link>
  )
}

export default function OverviewPage() {
  const { me, isSuperAdmin, firmId, firms, templateReviews } = useAdminSession()
  const firmQuery = isSuperAdmin && firmId ? `firm_id=${firmId}` : ''
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const names = useResolvedNames(stats?.recent)

  useEffect(() => {
    let cancelled = false
    setStats(null)
    setError(null)
    loadStats(firmQuery)
      .then((result) => !cancelled && setStats(result))
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error && err.message !== 'not authenticated' ? err.message : messageOf(err))
      })
    return () => {
      cancelled = true
    }
  }, [firmQuery])

  const scope = isSuperAdmin
    ? firmId
      ? (firms.find((f) => f.id === firmId)?.name ?? 'the selected firm')
      : 'all firms'
    : me.firm_name || 'your firm'
  const firstName = isSuperAdmin ? '' : (me.display_name || '').split(/\s+/)[0]

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : isSuperAdmin ? 'Back office' : 'Overview'}
        description={`Verification activity for ${scope}.`}
        action={
          <Link href="/admin/links">
            <Button>
              <Icons.Plus className="h-4 w-4" />
              Generate link
            </Button>
          </Link>
        }
      />

      {error ? <Notice tone="error" className="mb-6">{error}</Notice> : null}

      {templateReviews?.count ? (
        <Link
          href="/admin/templates"
          className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-200 transition-colors hover:border-amber-500/50"
        >
          <Icons.CreditCard className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            <span className="font-medium text-amber-100">
              {templateReviews.count} new template{templateReviews.count === 1 ? '' : 's'} waiting for review
            </span>
            {templateReviews.newest ? <span className="text-amber-200/80"> · newest {fmtDate(templateReviews.newest)}</span> : null}
          </span>
          <span className="inline-flex items-center gap-1 font-medium">
            Review
            <Icons.ChevronRight className="h-4 w-4" />
          </span>
        </Link>
      ) : null}

      <Card className="mb-6 px-5 py-5">
        <p className="text-sm text-neutral-400">Total verifications</p>
        {stats ? (
          <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight text-white">{stats.total}</p>
        ) : (
          <Skeleton className="mt-2 h-10 w-20" />
        )}
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Tile label="Passed checks" value={stats?.verified ?? null} href="/admin/verifications?verified=true" accent="text-emerald-400" />
        <Tile label="Flagged" value={stats?.notVerified ?? null} href="/admin/verifications?verified=false" accent="text-rose-400" />
        <Tile label="Links not opened" value={stats ? (stats.links?.open ?? 0) : null} href="/admin/links" />
        <Tile label="Links opened, not submitted" value={stats ? (stats.links?.opened ?? 0) : null} href="/admin/links" accent="text-amber-400" />
        <Tile label="Links submitted" value={stats ? (stats.links?.submitted ?? 0) : null} href="/admin/links" accent="text-emerald-400" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Recent verifications"
          action={
            stats && stats.total > 0 ? (
              <Link href="/admin/verifications">
                <Button size="sm" variant="ghost">
                  View all
                </Button>
              </Link>
            ) : undefined
          }
        />
        {!stats ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : stats.recent.length === 0 ? (
          <EmptyState
            icon={Icons.ClipboardList}
            title="No verifications yet."
            description="Generate a link and send it to an applicant. Their verification appears here once submitted."
          />
        ) : (
          <ul className="divide-y divide-neutral-800/60">
            {stats.recent.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/admin/verifications/${row.id}`}
                  className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-neutral-800/30 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-neutral-100">
                      {rowName(row, names) || row.user_ref || `Verification #${row.id}`}
                    </span>
                    <span className="block text-xs text-neutral-500">
                      {[row.country, docTypeLabel(row.doc_type), fmtDate(row.created_at)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <StatusBadge tone={(decisionOf(row) ?? listFinding(row)).tone}>{(decisionOf(row) ?? listFinding(row)).label}</StatusBadge>
                  <Icons.ChevronRight className="h-4 w-4 shrink-0 text-neutral-600" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
