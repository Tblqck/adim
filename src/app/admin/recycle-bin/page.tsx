'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, ConfirmDialog, EmptyState, Icons, StatusBadge, useToast } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { Notice, TabStrip, TableSkeletonRows, TD, TH, TR } from '@/components/admin/kit'
import { DeletePermanentlyButton, RestoreButton, RETENTION_HOURS, timeUntilPurge } from '@/components/admin/recycle'
import { useAdminSession } from '@/components/admin/session-context'
import { adminFetch, apiJson, messageOf } from '@/lib/api'
import { docTypeLabel, fmtDate } from '@/lib/format'
import { rowName, useResolvedNames } from '@/lib/identity'
import type { LinkSession, Paged, VerificationRow } from '@/lib/types'
import { cn } from '@/lib/utils/cn'

type Kind = 'all' | 'verifications' | 'links'

interface Bin {
  verifications: VerificationRow[]
  verificationsScanned: number
  verificationsTotal: number
  links: LinkSession[]
}

const PAGE = 100
// The API has no "deleted only" filter, so binned verifications are found by
// reading the list. Capped so a very large history cannot stall the page; the
// page says so when the cap is hit.
const MAX_PAGES = 10

async function loadBin(firmQuery: string): Promise<Bin> {
  const verifications: VerificationRow[] = []
  let scanned = 0
  let total = 0
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await apiJson<Paged<VerificationRow>>(
      `/verifications?page=${page}&page_size=${PAGE}${firmQuery ? `&${firmQuery}` : ''}`,
      {},
      'Could not load verifications',
    )
    if (!result.ok) throw new Error(result.detail)
    total = result.data.total
    scanned += result.data.items.length
    verifications.push(...result.data.items.filter((v) => v.deleted_at))
    if (page * PAGE >= total || result.data.items.length === 0) break
  }
  const links = await apiJson<{ items: LinkSession[] }>(`/sessions${firmQuery ? `?${firmQuery}` : ''}`)
  return {
    verifications,
    verificationsScanned: scanned,
    verificationsTotal: total,
    links: links.ok ? links.data.items.filter((l) => l.deleted_at) : [],
  }
}

interface Entry {
  key: string
  kind: 'verification' | 'link'
  deletedAt: string
  title: ReactNode
  detail: ReactNode
  restorePath: string
  /** Only a back-office session can delete a binned verification early. */
  deleteNowPath: string | null
}

/**
 * The Recycle Bin — where deleting happens in this dashboard. Everything moved
 * here waits RETENTION_HOURS, restorable, until the server's sweep deletes it
 * for good (with its images). See src/components/admin/recycle.tsx for what
 * the live server can and cannot put here.
 */
export default function RecycleBinPage() {
  const { isSuperAdmin, firmId } = useAdminSession()
  const { toast } = useToast()
  const firmQuery = isSuperAdmin && firmId ? `firm_id=${firmId}` : ''
  const [bin, setBin] = useState<Bin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Kind>('all')
  const [bulk, setBulk] = useState<'restore' | 'empty' | null>(null)
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    setError(null)
    try {
      setBin(await loadBin(firmQuery))
    } catch (err) {
      setError(err instanceof Error && err.message !== 'not authenticated' ? err.message : messageOf(err))
    }
  }, [firmQuery])

  useEffect(() => {
    setBin(null)
    void load()
  }, [load])

  // Keep the countdowns honest while the page is open.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  const names = useResolvedNames(bin?.verifications)

  const entries: Entry[] = [
    ...(bin?.verifications ?? []).map<Entry>((v) => ({
      key: `v-${v.id}`,
      kind: 'verification',
      deletedAt: v.deleted_at ?? '',
      title: (
        <Link href={`/admin/verifications/${v.id}`} className="font-medium text-white hover:text-brand-300">
          {rowName(v, names) || `Verification #${v.id}`}
        </Link>
      ),
      detail: [`#${v.id}`, v.user_ref, docTypeLabel(v.doc_type), v.country].filter(Boolean).join(' · '),
      restorePath: `/verifications/${v.id}/restore`,
      deleteNowPath: isSuperAdmin ? `/verifications/${v.id}?confirm=true` : null,
    })),
    ...(bin?.links ?? []).map<Entry>((l) => ({
      key: `l-${l.id}`,
      kind: 'link',
      deletedAt: l.deleted_at ?? '',
      title: <span className="font-medium text-white">Link{l.user_ref ? ` for ${l.user_ref}` : ''}</span>,
      detail: `Created ${fmtDate(l.created_at)}`,
      restorePath: `/sessions/${l.id}/restore`,
      deleteNowPath: null,
    })),
  ].sort((a, b) => a.deletedAt.localeCompare(b.deletedAt)) // soonest to be purged first

  const shown = entries.filter((e) => tab === 'all' || (tab === 'verifications' ? e.kind === 'verification' : e.kind === 'link'))
  const count = (n: number) => <span className="rounded-full bg-neutral-800 px-1.5 py-px text-[11px] text-neutral-400">{bin ? n : '…'}</span>
  const deletable = shown.filter((e) => e.deleteNowPath)

  async function runBulk(kind: 'restore' | 'empty') {
    const targets = kind === 'restore' ? shown : deletable
    let failed = 0
    for (const entry of targets) {
      const path = kind === 'restore' ? entry.restorePath : entry.deleteNowPath
      if (!path) continue
      try {
        const response = await adminFetch(path, { method: kind === 'restore' ? 'POST' : 'DELETE' })
        if (!response.ok) failed++
      } catch {
        failed++
      }
    }
    setBulk(null)
    const done = targets.length - failed
    toast(
      failed
        ? `${done} done, ${failed} failed — see the items still listed`
        : kind === 'restore'
          ? `Restored ${done} item${done === 1 ? '' : 's'}`
          : `Deleted ${done} item${done === 1 ? '' : 's'} permanently`,
      failed ? 'error' : 'success',
    )
    await load()
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Recycle Bin"
        description={`Deleted verifications and links wait here for ${RETENTION_HOURS} hours and can be restored. After that the server deletes them permanently, images included.`}
        action={
          shown.length ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setBulk('restore')}>
                <Icons.Refresh className="h-4 w-4" />
                Restore all
              </Button>
              {deletable.length ? (
                <Button variant="danger" onClick={() => setBulk('empty')}>
                  <Icons.Trash className="h-4 w-4" />
                  Empty bin
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      {error ? <Notice tone="error">{error}</Notice> : null}
      {isSuperAdmin ? (
        <Notice>
          A back-office delete is immediate on the server, so it never lands here — only deletes made from firm logins do. From here the
          back office can restore them, or delete them before the {RETENTION_HOURS}-hour window ends.
        </Notice>
      ) : null}
      {bin && bin.verificationsScanned < bin.verificationsTotal ? (
        <Notice tone="warning">
          Checked the newest {bin.verificationsScanned} of {bin.verificationsTotal} verifications for deleted ones. Anything older is not listed
          here.
        </Notice>
      ) : null}

      <TabStrip
        label="Deleted item types"
        className="border-b border-neutral-800"
        active={tab}
        onSelect={setTab}
        tabs={[
          { key: 'all', label: <>All {count(entries.length)}</> },
          { key: 'verifications', label: <>Verifications {count(entries.filter((e) => e.kind === 'verification').length)}</> },
          { key: 'links', label: <>Links {count(entries.filter((e) => e.kind === 'link').length)}</> },
        ]}
      />

      <Card>
        {!bin && !error ? (
          <table className="w-full">
            <tbody>
              <TableSkeletonRows cols={4} rows={4} />
            </tbody>
          </table>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={Icons.Trash}
            title="The bin is empty."
            description="Verifications and links you delete appear here, restorable, until they are removed for good."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className={TH}>Item</th>
                  <th className={cn(TH, 'hidden md:table-cell')}>Deleted</th>
                  <th className={TH}>Removed for good</th>
                  <th className={cn(TH, 'text-right')}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((entry) => (
                  <tr key={entry.key} className={TR}>
                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone={entry.kind === 'verification' ? 'brand' : 'neutral'}>
                          {entry.kind === 'verification' ? 'Verification' : 'Link'}
                        </StatusBadge>
                        {entry.title}
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-500">{entry.detail}</div>
                    </td>
                    <td className={cn(TD, 'hidden whitespace-nowrap text-neutral-400 md:table-cell')}>{fmtDate(entry.deletedAt)}</td>
                    <td className={cn(TD, 'whitespace-nowrap')}>
                      <span className="inline-flex items-center gap-1.5 text-amber-300">
                        <Icons.Clock className="h-3.5 w-3.5" />
                        {timeUntilPurge(entry.deletedAt)}
                      </span>
                    </td>
                    <td className={cn(TD, 'text-right')}>
                      <div className="flex justify-end gap-1">
                        <RestoreButton path={entry.restorePath} onDone={load} />
                        {entry.deleteNowPath ? (
                          <DeletePermanentlyButton
                            path={entry.deleteNowPath}
                            title="Delete this verification permanently?"
                            description="It is removed now, with its images, instead of at the end of the retention window. This cannot be undone."
                            label="Delete now"
                            onDone={load}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={bulk === 'restore'}
        onClose={() => setBulk(null)}
        onConfirm={() => runBulk('restore')}
        title={`Restore ${shown.length} item${shown.length === 1 ? '' : 's'}?`}
        description="They go back to their lists as they were."
        confirmLabel="Restore all"
        confirmVariant="primary"
      />
      <ConfirmDialog
        open={bulk === 'empty'}
        onClose={() => setBulk(null)}
        onConfirm={() => runBulk('empty')}
        title={`Delete ${deletable.length} verification${deletable.length === 1 ? '' : 's'} permanently?`}
        description="They are removed now, with their images, and cannot be restored. Links cannot be deleted early — the server removes them when their window ends."
        confirmLabel="Empty bin"
      />
    </div>
  )
}
