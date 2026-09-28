'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, EmptyState, Icons, Input, Select, StatusBadge } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { CountryInput, Notice, TableSkeletonRows, TD, TH, TR, TR_CLICKABLE } from '@/components/admin/kit'
import { DeletePermanentlyButton, MoveToBinButton } from '@/components/admin/recycle'
import { SourceChip } from '@/components/admin/source-chip'
import { useAdminSession } from '@/components/admin/session-context'
import { apiJson, messageOf } from '@/lib/api'
import { countryFlag, countryByCode } from '@/lib/countries'
import { DOC_TYPES, docTypeLabel, fmtDate, fmtPct } from '@/lib/format'
import { decisionOf, listFinding } from '@/lib/assess'
import type { Paged, VerificationRow } from '@/lib/types'
import { cn } from '@/lib/utils/cn'
import { listNameOf, nameContains, resolveName, rowName, useResolvedNames } from '@/lib/identity'

const PAGE_SIZE = 25
const FILTER_KEYS = ['verified', 'doc_type', 'country', 'date_from', 'date_to', 'source', 'q'] as const

// Source (verification_mode) is filtered here, not on the server: the live
// list endpoint has no parameter for it. With a source picked, the newest
// SOURCE_SCAN_ROWS rows matching every other filter are read and narrowed in
// the browser, and paged here. Move to the server with the rest when it
// gains a verification_mode filter.
const SOURCE_SCAN_ROWS = 1000
const SOURCES = [
  { value: '3', label: 'Liveness' },
  { value: '1', label: 'Selfie' },
  { value: '2', label: 'Holding photo' },
] as const

async function scanBySource(base: URLSearchParams, source: string): Promise<{ rows: VerificationRow[]; scanned: number; total: number }> {
  const rows: VerificationRow[] = []
  let scanned = 0
  let total = 0
  for (let page = 1; page <= SOURCE_SCAN_ROWS / 100; page++) {
    const query = new URLSearchParams(base)
    query.set('page', String(page))
    query.set('page_size', '100')
    const result = await apiJson<Paged<VerificationRow>>(`/verifications?${query}`, {}, 'Could not load verifications')
    if (!result.ok) throw new Error(result.detail)
    total = result.data.total
    scanned += result.data.items.length
    rows.push(...result.data.items.filter((row) => String(row.verification_mode ?? '') === source))
    if (page * 100 >= total || result.data.items.length === 0) break
  }
  return { rows, scanned, total }
}
type FilterKey = (typeof FILTER_KEYS)[number]
type Filters = Record<FilterKey, string>

// The live server's search only matches the stored full name, the document
// number and the user reference. Rows whose full name was never stored (OCR
// missed it; see src/lib/identity.ts) can only be found by name here: the
// newest SCAN_ROWS rows without a stored name are resolved from their detail
// and matched in the browser. Remove once the server searches given names
// and surnames itself.
const SCAN_ROWS = 200
const SEARCH_DEBOUNCE_MS = 300

async function nameOnlyMatches(q: string, base: URLSearchParams, alreadyShown: Set<number>): Promise<VerificationRow[]> {
  const candidates: VerificationRow[] = []
  for (let page = 1; page <= SCAN_ROWS / 100; page++) {
    const query = new URLSearchParams(base)
    query.delete('q')
    query.set('page', String(page))
    query.set('page_size', '100')
    const result = await apiJson<Paged<VerificationRow>>(`/verifications?${query}`)
    if (!result.ok) break
    candidates.push(...result.data.items.filter((row) => !listNameOf(row) && !alreadyShown.has(row.id)))
    if (page * 100 >= result.data.total) break
  }
  const matches: VerificationRow[] = []
  const queue = [...candidates]
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift()
        if (!row) return
        if (nameContains(await resolveName(row.id), q)) matches.push(row)
      }
    }),
  )
  return matches
}

export function VerificationsList() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { isSuperAdmin, firmId } = useAdminSession()
  const firmQuery = isSuperAdmin && firmId ? `firm_id=${firmId}` : ''

  // The URL is the source of truth, so back/forward and a refresh keep the filters.
  const applied: Filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Filters
  const page = Math.max(1, Number(params.get('page')) || 1)
  const queryString = params.toString()

  const [data, setData] = useState<Paged<VerificationRow> | null>(null)
  const [extra, setExtra] = useState<VerificationRow[]>([])
  const [scanning, setScanning] = useState(false)
  const [sourceScan, setSourceScan] = useState<{ scanned: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const request = useRef(0)

  // Every filter applies the moment it changes, as on the white-label list.
  // replace, not push: typing a name should not leave a history entry per letter.
  const apply = useCallback(
    (next: Partial<Filters>, nextPage = 1) => {
      const current = new URLSearchParams(queryString)
      const query = new URLSearchParams()
      for (const key of FILTER_KEYS) {
        const value = key in next ? next[key] : current.get(key)
        if (value) query.set(key, value)
      }
      if (nextPage > 1) query.set('page', String(nextPage))
      router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [queryString, pathname, router],
  )

  // Search text is local while typing and reaches the URL after a short pause.
  const [search, setSearch] = useState(applied.q)
  const sentQ = useRef(applied.q)
  useEffect(() => {
    // An outside change (back/forward, Clear) — not our own debounce — resets the box.
    if (applied.q !== sentQ.current) {
      sentQ.current = applied.q
      setSearch(applied.q)
    }
  }, [applied.q])
  useEffect(() => {
    const q = search.trim()
    if (q === sentQ.current) return
    const timer = setTimeout(() => {
      sentQ.current = q
      apply({ q })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, apply])

  const load = useCallback(async () => {
    const mine = ++request.current
    setLoading(true)
    setError(null)
    setExtra([])
    setSourceScan(null)
    const query = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
    const current = new URLSearchParams(queryString)
    for (const key of FILTER_KEYS) {
      const value = current.get(key)
      if (value && key !== 'source') query.set(key, value)
    }
    if (firmQuery) query.set('firm_id', String(firmId))
    const source = current.get('source')
    try {
      let shown: Paged<VerificationRow>
      if (source) {
        const scan = await scanBySource(query, source)
        if (mine !== request.current) return
        shown = { items: scan.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: scan.rows.length, page, page_size: PAGE_SIZE }
        setSourceScan({ scanned: scan.scanned, total: scan.total })
      } else {
        const result = await apiJson<Paged<VerificationRow>>(`/verifications?${query}`, {}, 'Could not load verifications')
        if (mine !== request.current) return
        if (!result.ok) {
          setError(result.detail)
          return
        }
        shown = result.data
      }
      setData(shown)
      setLoading(false)

      const q = current.get('q')?.trim()
      if (q && page === 1) {
        setScanning(true)
        const found = await nameOnlyMatches(q, query, new Set(shown.items.map((row) => row.id)))
        if (mine === request.current) setExtra(source ? found.filter((row) => String(row.verification_mode ?? '') === source) : found)
      }
    } catch (err) {
      if (mine === request.current) setError(err instanceof Error && err.message !== 'not authenticated' ? err.message : messageOf(err))
    } finally {
      if (mine === request.current) {
        setLoading(false)
        setScanning(false)
      }
    }
  }, [page, queryString, firmQuery, firmId])

  useEffect(() => {
    void load()
  }, [load])

  // Binned rows are listed in the Recycle Bin only; the server still returns
  // them here, so they are dropped from this page.
  const rows = data
    ? [...data.items, ...extra].filter((row) => !row.deleted_at).sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    : undefined
  const names = useResolvedNames(rows)
  // The server's total still counts binned rows. Those on this page are
  // subtracted; binned rows on other pages cannot be seen from here, so a
  // multi-page count can still be a little high until the bin is purged.
  const binnedHere = (data?.items ?? []).filter((row) => row.deleted_at).length
  const total = (data?.total ?? 0) - binnedHere + extra.length
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))
  const hasFilters = FILTER_KEYS.some((k) => applied[k])

  return (
    <>
      <PageHeader
        title="Verifications"
        description={loading && !data ? 'Loading…' : `${total} verification${total === 1 ? '' : 's'}${hasFilters ? ' match these filters' : ''}.`}
        action={
          <div className="flex gap-2">
            <Link href="/admin/recycle-bin">
              <Button variant="secondary">
                <Icons.Trash className="h-4 w-4" />
                Recycle Bin
              </Button>
            </Link>
            <Link href="/admin/links">
              <Button>
                <Icons.Plus className="h-4 w-4" />
                Generate link
              </Button>
            </Link>
          </div>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 p-4 sm:px-5">
          <div className="relative min-w-0 flex-1 basis-64">
            <Icons.Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <Input
              value={search}
              placeholder="Search name, ID number, user ref…"
              aria-label="Search"
              className="pl-9 pr-9"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  sentQ.current = search.trim()
                  apply({ q: search.trim() })
                }
              }}
            />
            {scanning ? (
              <Icons.Spinner
                className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-neutral-500"
                aria-label="Also checking names the server has not stored"
              />
            ) : null}
          </div>
          <div className="w-40">
            <Select value={applied.verified} onChange={(e) => apply({ verified: e.target.value })} aria-label="Status">
              <option value="">Any status</option>
              <option value="true">Passed checks</option>
              <option value="false">Flagged</option>
            </Select>
          </div>
          <div className="w-44">
            <Select value={applied.source} onChange={(e) => apply({ source: e.target.value })} aria-label="Source">
              <option value="">Any source</option>
              {SOURCES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Select value={applied.doc_type} onChange={(e) => apply({ doc_type: e.target.value })} aria-label="Document">
              <option value="">Any document</option>
              {DOC_TYPES.map((doc) => (
                <option key={doc.value} value={doc.value}>
                  {doc.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-52">
            <CountryInput value={applied.country} onChange={(country) => apply({ country })} placeholder="Any country" />
          </div>
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From" className="w-40" value={applied.date_from} onChange={(e) => apply({ date_from: e.target.value })} />
            <span className="text-neutral-600">–</span>
            <Input type="date" aria-label="To" className="w-40" value={applied.date_to} onChange={(e) => apply({ date_to: e.target.value })} />
          </div>
          {hasFilters ? (
            <Button variant="ghost" onClick={() => router.replace(pathname, { scroll: false })}>
              <Icons.Close className="h-4 w-4" />
              Clear
            </Button>
          ) : null}
        </div>

        {sourceScan && sourceScan.scanned < sourceScan.total ? (
          <div className="border-b border-neutral-800 p-4 sm:px-5">
            <Notice tone="warning">
              Source is filtered over the newest {sourceScan.scanned} of {sourceScan.total} verifications. Narrow the dates to reach older ones.
            </Notice>
          </div>
        ) : null}
        {error ? (
          <div className="p-4 sm:p-5">
            <Notice tone="error">{error}</Notice>
          </div>
        ) : !loading && rows && rows.length === 0 && !scanning ? (
          hasFilters ? (
            <EmptyState icon={Icons.Search} title="No matching verifications." description="Nothing matches these filters. Try a different search or clear them." />
          ) : (
            <EmptyState icon={Icons.ClipboardList} title="No verifications yet." description="Verifications appear here as soon as applicants submit them." />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th scope="col" className={TH}>Submitted</th>
                  <th scope="col" className={TH}>Name, reference</th>
                  <th scope="col" className={cn(TH, 'hidden md:table-cell')}>Source</th>
                  <th scope="col" className={cn(TH, 'hidden lg:table-cell')}>Issue country</th>
                  <th scope="col" className={cn(TH, 'hidden md:table-cell')}>Document</th>
                  <th scope="col" className={TH}>Attention</th>
                  <th scope="col" className={cn(TH, 'hidden sm:table-cell text-right')}>Score</th>
                  <th scope="col" className={cn(TH, 'text-right')}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeletonRows cols={8} rows={8} />
                ) : (
                  rows?.map((row) => {
                    const country = countryByCode(row.country)
                    return (
                      <tr
                        key={row.id}
                        className={cn(TR, TR_CLICKABLE)}
                        onClick={() => router.push(`/admin/verifications/${row.id}`)}
                      >
                        <td className={cn(TD, 'whitespace-nowrap text-neutral-400')}>{fmtDate(row.created_at)}</td>
                        <td className={TD}>
                          <div className="font-medium text-white">
                            {rowName(row, names) ?? (names.has(row.id) ? <span className="text-neutral-500">No name read</span> : <span className="inline-block h-4 w-32 animate-pulse rounded bg-neutral-800/70 align-middle" />)}
                          </div>
                          <div className="text-xs text-neutral-500">
                            #{row.id}
                            {row.user_ref ? ` · ${row.user_ref}` : ''}
                          </div>
                        </td>
                        <td className={cn(TD, 'hidden md:table-cell')}>
                          <SourceChip mode={row.verification_mode} />
                        </td>
                        <td className={cn(TD, 'hidden lg:table-cell')}>
                          {country ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span aria-hidden="true">{countryFlag(country.code2)}</span>
                              {country.name}
                            </span>
                          ) : (
                            row.country || '—'
                          )}
                        </td>
                        <td className={cn(TD, 'hidden md:table-cell')}>{docTypeLabel(row.doc_type)}</td>
                        <td className={TD}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge tone={listFinding(row).tone}>{listFinding(row).label}</StatusBadge>
                            {decisionOf(row) ? <StatusBadge tone={decisionOf(row)!.tone}>{decisionOf(row)!.label}</StatusBadge> : null}
                          </div>
                        </td>
                        <td className={cn(TD, 'hidden text-right tabular-nums sm:table-cell')}>{fmtPct(row.confidence_score)}</td>
                        <td className={cn(TD, 'text-right')}>
                          {isSuperAdmin ? (
                            <DeletePermanentlyButton
                              path={`/verifications/${row.id}?confirm=true`}
                              title="Delete this verification permanently?"
                              description="Back-office deletes are immediate on the server — this does not go to the Recycle Bin and cannot be undone. To keep it recoverable, delete it from a firm login instead."
                              label="Delete"
                              onDone={load}
                            />
                          ) : (
                            <MoveToBinButton path={`/verifications/${row.id}`} what="this verification" onDone={load} />
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3 text-sm text-neutral-400 sm:px-5">
          <span>
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => apply({}, page - 1)}>
              <Icons.ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= pages || loading} onClick={() => apply({}, page + 1)}>
              Next
              <Icons.ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </>
  )
}
