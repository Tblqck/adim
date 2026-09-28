'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button, Card, CardHeader, EmptyState, Icons, StatusBadge, useToast } from '@/components/ui'
import { Notice } from '@/components/admin/kit'
import { useAdminSession } from '@/components/admin/session-context'
import { backfillFromVerification, DEFAULT_SLOTS, listTemplates, templateImageUrl, templateServiceMissing } from '@/lib/design-templates'
import { docTypeLabel, fmtDay, humanize } from '@/lib/format'
import type { DesignTemplate, VerificationRow } from '@/lib/types'
import { countryFlag } from '@/lib/countries'

type Load = { kind: 'loading' } | { kind: 'missing' } | { kind: 'error'; message: string } | { kind: 'ready'; items: DesignTemplate[]; slots: number }

export function useDesignTemplates(params: { country?: string; doc_type?: string } = {}) {
  const [state, setState] = useState<Load>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const key = `${params.country ?? ''}/${params.doc_type ?? ''}`
  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    listTemplates(params)
      .then((r) => {
        if (cancelled) return
        if (r.ok) setState({ kind: 'ready', items: r.data.items, slots: r.data.slots ?? DEFAULT_SLOTS })
        else setState(templateServiceMissing(r) ? { kind: 'missing' } : { kind: 'error', message: r.detail })
      })
      .catch(() => !cancelled && setState({ kind: 'error', message: 'Could not reach the server.' }))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params are captured by key
  }, [key, tick])
  return { state, reload: () => setTick((t) => t + 1) }
}

export function TemplateServiceMissing() {
  return (
    <Notice tone="warning">
      <strong className="font-medium text-amber-100">The template service is not connected yet.</strong> The engine and editor are built; two
      server steps switch them on: deploy the template relay on the EC2 API (<code className="font-mono">api/routers/admin.py</code>,{' '}
      <code className="font-mono">verify.py</code>) and restart the AI server&rsquo;s ingest service once (
      <code className="font-mono">systemctl restart solve2-ingest</code>).
    </Notice>
  )
}

function TemplateTile({ t }: { t: DesignTemplate }) {
  return (
    <Link
      href={`/admin/templates/editor/${t.id}`}
      className="group overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 transition-colors hover:border-brand-500/50"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- relay-served, cookie-authenticated */}
      <img src={templateImageUrl(t.id)} alt={`${t.side} template`} loading="lazy" className="aspect-[1.58] w-full object-cover" />
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0">
          <span className="block truncate text-sm text-neutral-100 group-hover:text-brand-300">
            {humanize(t.side)} · {t.label || t.id.slice(0, 6)}
          </span>
          <span className="block text-xs text-neutral-500">
            {t.status === 'active' ? `${t.match_count} matched` : `Draft · ${fmtDay(t.created_at)}`}
          </span>
        </span>
        <StatusBadge tone={t.status === 'active' ? 'success' : 'warning'}>{t.status === 'active' ? 'Approved' : 'Draft'}</StatusBadge>
      </div>
    </Link>
  )
}

/** The review queue on the Templates index: every draft waiting for an admin. */
export function ReviewQueue() {
  const { state } = useDesignTemplates()
  if (state.kind === 'missing') return <TemplateServiceMissing />
  if (state.kind !== 'ready') return null
  const drafts = state.items.filter((t) => t.status === 'draft')
  const active = state.items.filter((t) => t.status === 'active').length
  return (
    <Card>
      <CardHeader
        title={`Review queue${drafts.length ? ` · ${drafts.length}` : ''}`}
        description={`${active} approved template${active === 1 ? '' : 's'} in use. Drafts are built automatically from incoming documents and wait here until an admin checks the redaction.`}
      />
      {drafts.length ? (
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-4">
          {drafts.map((t) => (
            <div key={t.id} className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs text-neutral-400">
                <span aria-hidden="true">{countryFlag(t.country)}</span>
                {t.country} · {docTypeLabel(t.doc_type)}
              </p>
              <TemplateTile t={t} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Icons.CheckCircle} title="Nothing to review." description="New drafts appear here as documents of new designs come in." className="py-10 sm:py-12" />
      )}
    </Card>
  )
}

/** Templates of one design, and the backfill from its past verifications. */
export function DesignTemplates({ country, docType, rows }: { country: string; docType: string; rows: VerificationRow[] }) {
  const { isSuperAdmin } = useAdminSession()
  const { toast } = useToast()
  const { state, reload } = useDesignTemplates({ country, doc_type: docType })
  const [queueing, setQueueing] = useState(false)

  async function backfill() {
    // The newest few are enough: each becomes at most a draft, and the AI
    // server stops adding drafts for a design once its review queue is full.
    const picks = rows.slice(0, 5)
    setQueueing(true)
    let ok = 0
    let failed = ''
    for (const row of picks) {
      const r = await backfillFromVerification(row.id).catch(() => null)
      if (r?.ok) ok++
      else if (r && !failed) failed = r.detail
    }
    setQueueing(false)
    toast(
      ok ? `Queued ${ok} past verification${ok === 1 ? '' : 's'} — drafts appear here in a few minutes` : failed || 'Nothing could be queued',
      ok ? 'success' : 'error',
    )
    setTimeout(reload, 5000)
  }

  const items = state.kind === 'ready' ? state.items : []
  const slots = state.kind === 'ready' ? state.slots : DEFAULT_SLOTS
  const sides = [...new Set(['front', 'back', ...items.map((t) => t.side)])].filter((side) => items.some((t) => t.side === side) || side === 'front')
  return (
    <Card>
      <CardHeader
        title="Samples"
        description={`Each side keeps up to ${slots} approved, redacted samples; every document is compared against all of them. The back office decides which fill the slots.`}
        action={
          isSuperAdmin && rows.length ? (
            <Button variant="secondary" size="sm" loading={queueing} onClick={backfill} disabled={state.kind === 'missing'}>
              <Icons.Plus className="h-4 w-4" />
              Offer past documents as drafts
            </Button>
          ) : undefined
        }
      />
      <div className="p-4 sm:p-5">
        {state.kind === 'missing' ? (
          <TemplateServiceMissing />
        ) : state.kind === 'error' ? (
          <Notice tone="error">{state.message}</Notice>
        ) : state.kind === 'loading' ? (
          <p className="text-sm text-neutral-500">Loading templates…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-neutral-400">
            No samples for this design yet. The next document of this design is offered as a draft automatically
            {isSuperAdmin ? ', or offer past documents now.' : '.'}
          </p>
        ) : (
          <div className="space-y-6">
            {sides.map((side) => {
              const approved = items.filter((t) => t.side === side && t.status === 'active')
              const drafts = items.filter((t) => t.side === side && t.status === 'draft')
              const full = approved.length >= slots
              return (
                <section key={side} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-white">{humanize(side).replace(/^./, (c) => c.toUpperCase())}</h3>
                    <span className={full ? 'text-xs text-emerald-400' : 'text-xs text-neutral-400'}>
                      {approved.length} of {slots} sample slots filled
                    </span>
                  </div>
                  <div className="flex gap-1" aria-hidden="true">
                    {Array.from({ length: slots }, (_, i) => (
                      <span key={i} className={i < approved.length ? 'h-1.5 flex-1 rounded-full bg-emerald-500' : 'h-1.5 flex-1 rounded-full bg-neutral-800'} />
                    ))}
                  </div>
                  {approved.length ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                      {approved.map((t) => (
                        <TemplateTile key={t.id} t={t} />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-500">No approved samples on this side yet.</p>
                  )}
                  {drafts.length ? (
                    <div className="space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
                      <p className="text-xs font-medium text-amber-300">
                        Waiting for review · {drafts.length}
                        {full ? ' — the slots are full, so approving one means choosing a sample to replace' : ''}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                        {drafts.map((t) => (
                          <TemplateTile key={t.id} t={t} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}
