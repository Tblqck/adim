'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Card, CardHeader, EmptyState, Field, Icons, Input, QrCode, StatusBadge, type StatusTone } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { CopyButton, Notice, Section, TableSkeletonRows, TD, TH, TR } from '@/components/admin/kit'
import { MoveToBinButton } from '@/components/admin/recycle'
import { useAdminSession } from '@/components/admin/session-context'
import { FirmSearch } from '@/components/admin/firm-search'
import { apiJson, jsonBody, messageOf } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { LinkSession } from '@/lib/types'
import { cn } from '@/lib/utils/cn'

interface NewLink {
  token: string
  url: string | null
  expires_at: string
}

/**
 * The server tracks two hard states (pending / used). "Opened" is a softer
 * layer on top, so "never opened", "opened but abandoned" and "expired
 * before anyone tried" read differently at a glance.
 */
function lifecycle(row: LinkSession): { label: string; tone: StatusTone } {
  const expired = new Date(row.expires_at).getTime() < Date.now()
  if (row.status === 'used') return { label: 'Submitted', tone: 'success' }
  if (expired) return row.opened_at ? { label: 'Expired — opened, not submitted', tone: 'danger' } : { label: 'Expired — never opened', tone: 'muted' }
  if (row.opened_at) return { label: 'Opened — not submitted', tone: 'warning' }
  return { label: 'Pending — not opened', tone: 'brand' }
}

export default function GenerateLinkPage() {
  const { isSuperAdmin, firmId, firms } = useAdminSession()
  const firmName = (id: number | null | undefined) => (id == null ? null : (firms.find((f) => f.id === id)?.name ?? `Firm #${id}`))
  const firmQuery = isSuperAdmin && firmId ? `?firm_id=${firmId}` : ''
  // A link always belongs to exactly one firm. A firm login's is its own
  // (the server takes it from the session); the back office picks one here,
  // starting from the sidebar's firm filter when one is set.
  const [linkFirm, setLinkFirm] = useState<number | null>(firmId)
  useEffect(() => {
    if (firmId) setLinkFirm(firmId)
  }, [firmId])
  const needsFirm = isSuperAdmin && !linkFirm

  const [userRef, setUserRef] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<(NewLink & { firmId: number | null }) | null>(null)

  const [links, setLinks] = useState<LinkSession[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const loadLinks = useCallback(async () => {
    setListError(null)
    try {
      const result = await apiJson<{ items: LinkSession[] }>(`/sessions${firmQuery}`, {}, 'Could not load recent links')
      if (result.ok) setLinks((result.data.items ?? []).filter((l) => !l.deleted_at))
      else setListError(result.detail)
    } catch (err) {
      setListError(messageOf(err))
    }
  }, [firmQuery])

  useEffect(() => {
    setLinks(null)
    void loadLinks()
  }, [loadLinks])

  async function generate() {
    setError(null)
    setGenerating(true)
    try {
      const result = await apiJson<NewLink>(
        '/sessions',
        { method: 'POST', ...jsonBody({ user_ref: userRef.trim() || null, firm_id: isSuperAdmin ? linkFirm : null }) },
        'Failed to generate link',
      )
      if (!result.ok) {
        setError(result.detail)
        return
      }
      setCreated({ ...result.data, firmId: isSuperAdmin ? linkFirm : null })
      setUserRef('')
      void loadLinks()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Generate link"
        description="A single-use verification link for one applicant. It expires after 24 hours; only this disposable token ever reaches the applicant's browser."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="New link">
          <div className="space-y-4">
            {isSuperAdmin ? (
              <Field label="Firm" htmlFor="link-firm" hint="The firm this applicant is verifying for — the result appears in that firm's dashboard.">
                <FirmSearch id="link-firm" value={linkFirm} onChange={setLinkFirm} />
              </Field>
            ) : null}
            <Field label="Applicant reference" htmlFor="user-ref" hint="Optional — your own ID for this person, shown on their verification.">
              <Input value={userRef} onChange={(e) => setUserRef(e.target.value)} placeholder="e.g. applicant-1042" onKeyDown={(e) => e.key === 'Enter' && !needsFirm && generate()} />
            </Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button onClick={generate} loading={generating} disabled={needsFirm}>
              <Icons.Link className="h-4 w-4" />
              Generate link
            </Button>
          </div>
        </Section>

        {created ? (
          <Section
            title="Link ready"
            description={`${created.firmId ? `For ${firmName(created.firmId)} · ` : ''}Single-use, expires ${fmtDate(created.expires_at)}.`}
          >
            {created.url ? (
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="shrink-0 rounded-xl bg-white p-2">
                  <QrCode value={created.url} size={148} />
                </div>
                <div className="min-w-0 space-y-3">
                  <p className="break-all font-mono text-sm text-neutral-100">{created.url}</p>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton value={created.url} label="Copy link" />
                    <a href={created.url} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="sm">
                        <Icons.ExternalLink className="h-4 w-4" />
                        Open
                      </Button>
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Notice tone="warning">
                  CAPTURE_BASE_URL is not configured on the server, so a full link could not be built. The token is still valid — append it
                  to your capture page as <code className="font-mono">?token=…</code>.
                </Notice>
                <p className="break-all font-mono text-sm text-neutral-100">{created.token}</p>
                <CopyButton value={created.token} label="Copy token" />
              </div>
            )}
          </Section>
        ) : null}
      </div>

      <Card>
        <CardHeader title="Recent links" description={links ? `${links.length} links` : undefined} />
        {listError ? (
          <div className="p-4 sm:p-5">
            <Notice tone="error">{listError}</Notice>
          </div>
        ) : links && links.length === 0 ? (
          <EmptyState icon={Icons.Link} title="No links yet." description="Links you generate appear here with whether the applicant opened and submitted them." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className={TH}>Created</th>
                  {isSuperAdmin ? <th className={TH}>Firm</th> : null}
                  <th className={TH}>Applicant ref</th>
                  <th className={TH}>Status</th>
                  <th className={cn(TH, 'hidden md:table-cell')}>Opened</th>
                  <th className={cn(TH, 'hidden md:table-cell')}>Expires</th>
                  <th className={cn(TH, 'text-right')}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!links ? (
                  <TableSkeletonRows cols={isSuperAdmin ? 7 : 6} rows={5} />
                ) : (
                  links.map((row) => {
                    const state = lifecycle(row)
                    return (
                      <tr key={row.id} className={TR}>
                        <td className={cn(TD, 'whitespace-nowrap text-neutral-400')}>{fmtDate(row.created_at)}</td>
                        {isSuperAdmin ? <td className={cn(TD, 'text-neutral-300')}>{firmName(row.firm_id) ?? <span className="text-neutral-500">—</span>}</td> : null}
                        <td className={TD}>{row.user_ref || <span className="text-neutral-500">—</span>}</td>
                        <td className={TD}>
                          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                        </td>
                        <td className={cn(TD, 'hidden whitespace-nowrap text-neutral-400 md:table-cell')}>{row.opened_at ? fmtDate(row.opened_at) : '—'}</td>
                        <td className={cn(TD, 'hidden whitespace-nowrap text-neutral-400 md:table-cell')}>{fmtDate(row.expires_at)}</td>
                        <td className={cn(TD, 'text-right')}>
                          <MoveToBinButton path={`/sessions/${row.id}`} what="this link" onDone={loadLinks} />
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
