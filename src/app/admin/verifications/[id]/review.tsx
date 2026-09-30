'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, Icons, Input, LoadingState, Select, StatusBadge, useToast } from '@/components/ui'
import { InfoGrid, InfoItem, Notice, Section, TabStrip, TD, TH, TR } from '@/components/admin/kit'
import { ScreeningResultView } from '@/components/admin/screening'
import { ForensicsView } from '@/components/admin/forensics'
import { SourceChip } from '@/components/admin/source-chip'
import { useAdminSession } from '@/components/admin/session-context'
import { apiJson, jsonBody, messageOf } from '@/lib/api'
import { countryFlag, countryByCode } from '@/lib/countries'
import { docTypeLabel, fmtDate, fmtPct, humanize, verdictTone } from '@/lib/format'
import type { MrzSide, VerificationDetail } from '@/lib/types'
import { cn } from '@/lib/utils/cn'
import { displayNameOf } from '@/lib/identity'
import { assessVerification, decisionOf, RESULT_TONE, type Assessment, type ReviewTab } from '@/lib/assess'
import { AttentionItems, ResultCard } from '@/components/admin/assessment'
import { TemplateMatchPanel } from '@/components/admin/template-match'
import { DeletePermanentlyButton, MoveToBinButton, RestoreButton, timeUntilPurge } from '@/components/admin/recycle'
import { useRouter } from 'next/navigation'
import { crossCheck, EDITABLE_FIELDS, fieldValue, mrzReading, VERDICT_OPTIONS } from '@/lib/checks'

type TabKey = ReviewTab

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'scores', label: 'Model scores' },
  { key: 'template', label: 'Template match' },
  { key: 'mrz', label: 'MRZ checksums' },
  { key: 'cross', label: 'Printed vs MRZ' },
  { key: 'forensics', label: 'Forensics & EXIF' },
  { key: 'pep', label: 'PEP & sanctions' },
]

interface Frame {
  label: string
  url: string
}

// ── Evidence (images), pinned beside every tab ──────────────────────────

/**
 * Rendered into <body>, not in place: the evidence panel sits inside the
 * page's animated tab column, which forms its own stacking context, so a
 * fixed overlay rendered there painted *under* the Summary and Identity
 * cards however high its z-index.
 */
function Lightbox({ frames, onClose }: { frames: Frame[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div className={cn('relative grid max-h-full w-full gap-4 animate-zoom-in', frames.length > 1 ? 'max-w-7xl md:grid-cols-2' : 'max-w-4xl')}>
        {frames.map((frame) => (
          <figure key={frame.url} className="flex min-h-0 flex-col items-center gap-2">
            {/* Signed storage URLs on another host; the optimiser would need it allow-listed. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={frame.url} alt={frame.label} className="max-h-[80vh] w-auto max-w-full rounded-xl border border-neutral-800 object-contain" />
            <figcaption className="text-sm text-neutral-300">{frame.label}</figcaption>
          </figure>
        ))}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-lg bg-neutral-900/80 p-2 text-neutral-300 hover:text-white"
      >
        <Icons.Close className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  )
}

function Evidence({ row }: { row: VerificationDetail }) {
  const images = row.images ?? {}
  const frames: Frame[] = [
    ...(images.id_front_url ? [{ label: 'ID front', url: images.id_front_url }] : []),
    ...(images.id_back_url ? [{ label: 'ID back', url: images.id_back_url }] : []),
    ...(images.face_urls ?? []).map((url, i) => ({ label: `Liveness frame ${i + 1}`, url })),
  ]
  const [compare, setCompare] = useState(false)
  const [picked, setPicked] = useState<Frame[]>([])
  const [open, setOpen] = useState<Frame[] | null>(null)

  function onPick(frame: Frame) {
    if (!compare) {
      setOpen([frame])
      return
    }
    // Click two frames to see them side by side; a third replaces the oldest.
    const already = picked.some((f) => f.url === frame.url)
    const next = already ? picked.filter((f) => f.url !== frame.url) : [...picked, frame].slice(-2)
    setPicked(next)
    if (next.length === 2 && !already) setOpen(next)
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3.5 sm:px-5">
        <h2 className="text-sm font-semibold text-white">Captured images</h2>
        {frames.length > 1 ? (
          <Button
            variant={compare ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              setCompare((c) => !c)
              setPicked([])
            }}
          >
            {compare ? 'Cancel compare' : 'Compare frames'}
          </Button>
        ) : null}
      </div>
      <div className="p-4 sm:p-5">
        {compare ? <p className="mb-3 text-xs text-neutral-400">Pick two frames to view them side by side.</p> : null}
        {frames.length ? (
          <div className="grid grid-cols-2 gap-3">
            {frames.map((frame) => {
              const selected = picked.some((f) => f.url === frame.url)
              return (
                <button
                  key={frame.url}
                  type="button"
                  onClick={() => onPick(frame)}
                  className={cn(
                    'group overflow-hidden rounded-xl border bg-neutral-950 text-left transition-colors',
                    selected ? 'border-brand-500 ring-1 ring-brand-500' : 'border-neutral-800 hover:border-neutral-600',
                    frame.label.startsWith('ID') && 'col-span-2',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={frame.url} alt={frame.label} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                  <span className="block px-3 py-2 text-xs text-neutral-400 group-hover:text-neutral-200">{frame.label}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            No images stored for this verification — storage may not be configured, or the upload is still in progress.
          </p>
        )}
      </div>
      {open ? <Lightbox frames={open} onClose={() => setOpen(null)} /> : null}
    </Card>
  )
}

// ── Tabs ────────────────────────────────────────────────────────────────

function Pill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <StatusBadge tone={ok ? 'success' : 'danger'}>{children}</StatusBadge>
}

interface EditState {
  editing: boolean
  corrections: Record<string, string>
  overrides: Record<string, string>
}

function OverviewTab({
  row,
  edit,
  setEdit,
  assessment,
  onOpen,
}: {
  row: VerificationDetail
  edit: EditState
  setEdit: (e: EditState) => void
  assessment: Assessment
  onOpen: (tab: TabKey) => void
}) {
  return (
    <div className="space-y-6">
      <ResultCard assessment={assessment} decision={decisionOf(row)} />
      <AttentionItems issues={assessment.issues} onOpen={onOpen} />

      <Section title="Summary">
        <InfoGrid>
          <InfoItem label="Match score">{fmtPct(row.confidence_score)}</InfoItem>
          <InfoItem label="Country">{row.country || '—'}</InfoItem>
          <InfoItem label="Document type">{docTypeLabel(row.doc_type)}</InfoItem>
          <InfoItem label="Submitted">{fmtDate(row.created_at)}</InfoItem>
          <InfoItem label="User ref">{row.user_ref || '—'}</InfoItem>
        </InfoGrid>
      </Section>

      <Section
        title="Extracted identity"
        description={edit.editing ? 'Editing — change a value, then Save, Approve or Reject to store it.' : undefined}
      >
        <InfoGrid>
          {EDITABLE_FIELDS.map(([key, label, aliases]) => {
            const original = fieldValue(row, key, aliases) ?? ''
            const corrected = !!row.corrected_fields?.[key]
            return (
              <InfoItem
                key={key}
                label={
                  <span className="inline-flex items-center gap-2">
                    {label}
                    {corrected && !edit.editing ? <StatusBadge tone="brand">corrected</StatusBadge> : null}
                  </span>
                }
              >
                {edit.editing ? (
                  <Input
                    className="mt-1"
                    value={edit.corrections[key] ?? original}
                    onChange={(event) => setEdit({ ...edit, corrections: { ...edit.corrections, [key]: event.target.value } })}
                  />
                ) : (
                  original || '—'
                )}
              </InfoItem>
            )
          })}
        </InfoGrid>
      </Section>
    </div>
  )
}

function ScoreCard({
  label,
  score,
  verdict,
  model,
  row,
  verdictKey,
  edit,
  setEdit,
}: {
  label: string
  score: number | null | undefined
  verdict: string | null | undefined
  model: string
  row: VerificationDetail
  verdictKey?: string
  edit: EditState
  setEdit: (e: EditState) => void
}) {
  const override = verdictKey ? row.verdict_overrides?.[verdictKey] : undefined
  const effective = override || verdict
  const options = verdictKey ? VERDICT_OPTIONS[verdictKey] : undefined
  return (
    <div className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-semibold tabular-nums text-white">{fmtPct(score)}</span>
        {effective ? (
          <StatusBadge tone={verdictTone(null, effective)} className="capitalize">
            {humanize(effective)}
          </StatusBadge>
        ) : null}
        {override ? <StatusBadge tone="brand">overridden</StatusBadge> : null}
      </div>
      <p className="text-xs leading-relaxed text-neutral-500">{model}</p>
      {edit.editing && options && verdictKey ? (
        <Select
          aria-label={`${label} override`}
          value={edit.overrides[verdictKey] ?? override ?? ''}
          onChange={(event) => setEdit({ ...edit, overrides: { ...edit.overrides, [verdictKey]: event.target.value } })}
        >
          <option value="">{verdict ? `No override (AI: ${humanize(verdict)})` : 'No override'}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {humanize(option)}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  )
}

function ScoresTab({ row, edit, setEdit }: { row: VerificationDetail; edit: EditState; setEdit: (e: EditState) => void }) {
  const sources = row.extracted_id_data?.[0]?.field_sources ?? null
  const showMrz = !!(row.mrz_verdict || row.verdict_overrides?.mrz_verdict)
  return (
    <div className="space-y-6">
      <Section
        title="Per-model results"
        description="Each score is tagged with the model or method that produced it, so a heuristic fallback can be weighed differently from a real model result."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <ScoreCard label="Face match" score={row.face_match_score} verdict={row.face_match_verdict} model="ArcFace R50 (w600k_r50.onnx) — cosine similarity against the ID photo" row={row} verdictKey="face_match_verdict" edit={edit} setEdit={setEdit} />
          <ScoreCard
            label="Liveness"
            score={row.liveness_score}
            verdict={row.liveness_verdict}
            model={row.liveness_method === 'onnx' ? 'MiniFASNetV2.onnx (anti-spoofing model)' : 'Heuristic fallback — Laplacian sharpness, not the ONNX anti-spoofing model'}
            row={row}
            edit={edit}
            setEdit={setEdit}
          />
          <ScoreCard label="Document match" score={row.document_match_score} verdict={row.document_match_verdict} model="ORB + colour histogram against cached reference images" row={row} verdictKey="document_match_verdict" edit={edit} setEdit={setEdit} />
          {showMrz ? <ScoreCard label="MRZ validation" score={null} verdict={row.mrz_verdict} model="ICAO 9303 check-digit validation" row={row} verdictKey="mrz_verdict" edit={edit} setEdit={setEdit} /> : null}
        </div>
        {row.overall_verdict ? (
          <p className="mt-4 text-xs text-neutral-500">
            Pipeline&rsquo;s combined verdict code: <span className="font-mono text-neutral-400">{row.overall_verdict}</span> — the Overview explains
            what is behind it.
          </p>
        ) : null}
      </Section>

      <Section title="OCR extraction quality">
        <div className="space-y-4">
          <InfoGrid>
            <InfoItem label="Words detected">{row.ocr_word_count ?? '—'}</InfoItem>
          </InfoGrid>
          {sources ? (
            <InfoGrid>
              {Object.entries(sources).map(([field, source]) => (
                <InfoItem key={field} label={<span className="capitalize">{humanize(field)}</span>}>
                  <StatusBadge tone={source === 'label' ? 'success' : 'warning'}>{source === 'label' ? 'Label match' : 'Regex guess'}</StatusBadge>
                </InfoItem>
              ))}
            </InfoGrid>
          ) : (
            <p className="text-sm text-neutral-500">Per-field source (label match vs regex guess) was not recorded for this verification.</p>
          )}
        </div>
      </Section>
    </div>
  )
}

function sideBadge(side: MrzSide | null | undefined) {
  if (!side) return <StatusBadge tone="muted">No MRZ zone detected</StatusBadge>
  if (side.parsed) return <StatusBadge tone="success">Parsed {side.format ? `(${side.format})` : ''}</StatusBadge>
  return <StatusBadge tone="warning">Detected, unreadable</StatusBadge>
}

function MrzTab({ row }: { row: VerificationDetail }) {
  const bySide = row.pipeline_response?.mrz_by_side
  const mrz = mrzReading(row)
  if (!bySide || !mrz) {
    return (
      <Notice>No MRZ zone was detected on either side of this document (or this verification predates per-side MRZ capture).</Notice>
    )
  }
  return (
    <div className="space-y-6">
      <Section title="MRZ detection by side">
        <div className="space-y-3">
          <InfoGrid>
            <InfoItem label="Front">{sideBadge(bySide.front)}</InfoItem>
            <InfoItem label="Back">{sideBadge(bySide.back)}</InfoItem>
          </InfoGrid>
          {bySide.expected_side ? (
            <p className="text-sm text-neutral-400">
              Expected MRZ side for this country and document: <span className="font-medium text-neutral-200">{bySide.expected_side}</span>
            </p>
          ) : null}
        </div>
      </Section>
      <Section title="Check digit validation" description={`Format detected: ${mrz.format || '—'}`}>
        <InfoGrid>
          {Object.entries(mrz.checksum_valid).map(([key, ok]) => (
            <InfoItem key={key} label={<span className="capitalize">{humanize(key)}</span>}>
              <Pill ok={ok}>{ok ? 'Passed' : 'Failed'}</Pill>
            </InfoItem>
          ))}
        </InfoGrid>
      </Section>
      <Section title="Identity read from the MRZ">
        <InfoGrid>
          <InfoItem label="Given name">{mrz.given_names || '—'}</InfoItem>
          <InfoItem label="Surname">{mrz.surname || '—'}</InfoItem>
          <InfoItem label="Date of birth">{mrz.date_of_birth || '—'}</InfoItem>
          <InfoItem label="Nationality">{mrz.nationality || '—'}</InfoItem>
          <InfoItem label="Sex">{mrz.sex || '—'}</InfoItem>
          <InfoItem label="Date of expiry">{mrz.expiry_date || '—'}</InfoItem>
          <InfoItem label="Document number" mono>
            {mrz.passport_number || '—'}
          </InfoItem>
        </InfoGrid>
      </Section>
    </div>
  )
}

function CrossTab({ row }: { row: VerificationDetail }) {
  const rows = crossCheck(row)
  const hasMrz = rows.some((r) => r.match !== null)
  return (
    <Card>
      {!hasMrz ? (
        <div className="p-4 sm:p-5">
          <Notice>No MRZ is available for this document — the printed fields are shown on their own, with no cross-check.</Notice>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800">
              <th className={TH}>Field</th>
              <th className={TH}>Printed (OCR)</th>
              <th className={TH}>MRZ</th>
              <th className={TH}>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={TR}>
                <td className={cn(TD, 'font-medium')}>{r.label}</td>
                <td className={cn(TD, 'font-mono text-[13px]')}>{r.ocrValue || '—'}</td>
                <td className={cn(TD, 'font-mono text-[13px]')}>{r.mrzValue || '—'}</td>
                <td className={TD}>
                  {r.match === null ? (
                    <span className="text-neutral-500">OCR value only</span>
                  ) : r.match ? (
                    <StatusBadge tone="success">Match</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Mismatch / incomplete</StatusBadge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ── Page ────────────────────────────────────────────────────────────────

const IDLE_EDIT: EditState = { editing: false, corrections: {}, overrides: {} }

export function VerificationReview({ id }: { id: string }) {
  const { toast } = useToast()
  const { me, isSuperAdmin } = useAdminSession()
  const router = useRouter()
  const [row, setRow] = useState<VerificationDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('overview')
  const [edit, setEdit] = useState<EditState>(IDLE_EDIT)
  const [saving, setSaving] = useState<'approve' | 'reject' | 'save' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await apiJson<VerificationDetail>(`/verifications/${encodeURIComponent(id)}`, {}, 'Could not load this verification')
      if (result.ok) {
        setRow(result.data)
        setLoadError(null)
      } else setLoadError(result.detail)
    } catch (error) {
      setLoadError(messageOf(error))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function submit(kind: 'approve' | 'reject' | 'save') {
    if (!row) return
    setSaveError(null)
    // Only values that actually changed go back; an emptied override means
    // "back to the AI verdict" and is sent as null so the server clears it.
    const corrections: Record<string, string> = {}
    for (const [key, , aliases] of EDITABLE_FIELDS) {
      const next = edit.corrections[key]?.trim()
      if (next !== undefined && next && next !== (fieldValue(row, key, aliases) ?? '')) corrections[key] = next
    }
    const overrides: Record<string, string | null> = {}
    for (const [key, value] of Object.entries(edit.overrides)) {
      if (value !== (row.verdict_overrides?.[key] ?? '')) overrides[key] = value || null
    }
    const changed = Object.keys(corrections).length > 0 || Object.keys(overrides).length > 0
    if (kind === 'save' && !changed) {
      setSaveError('No changed values to save.')
      return
    }

    // Newer servers stamp the reviewer from the session; older ones require
    // it in the body. Sending it satisfies both — the server ignores it when
    // it knows better.
    const body: Record<string, unknown> = { reviewed_by: me.display_name || me.firm_slug || 'admin' }
    if (edit.editing) {
      body.corrected_fields = corrections
      body.verdict_overrides = overrides
    }
    if (kind !== 'save') body.verified = kind === 'approve'

    setSaving(kind)
    try {
      const result = await apiJson<{ ok: boolean }>(`/verifications/${row.id}`, { method: 'PATCH', ...jsonBody(body) }, 'Update failed')
      if (!result.ok) {
        setSaveError(result.detail)
        return
      }
      toast(kind === 'approve' ? 'Verification approved' : kind === 'reject' ? 'Verification rejected' : 'Changes saved')
      setEdit(IDLE_EDIT)
      await load()
    } catch (error) {
      setSaveError(messageOf(error))
    } finally {
      setSaving(null)
    }
  }

  if (loadError && !row) {
    return (
      <div className="px-4 py-8 sm:px-6 md:px-8">
        <Link href="/admin/verifications" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200">
          <Icons.ChevronLeft className="h-4 w-4" />
          Verifications
        </Link>
        <Notice tone="error">{loadError}</Notice>
      </div>
    )
  }
  if (!row) return <LoadingState title="Loading verification" className="min-h-[60vh]" />

  const name = displayNameOf(row)
  const assessment = assessVerification(row)
  const decision = decisionOf(row)
  // Each tab carries the count of findings whose evidence it holds.
  const tabs = TABS.map((t) => {
    const count = assessment.countByTab[t.key]
    return {
      key: t.key,
      label: count ? (
        <>
          {t.label}
          <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[11px] font-medium text-amber-300">{count}</span>
        </>
      ) : (
        t.label
      ),
    }
  })
  const country = countryByCode(row.country)
  const meta: ReactNode[] = [
    ...(name ? [<span key="name" className="font-medium text-neutral-300">{name}</span>] : []),
    <span key="country" className="inline-flex items-center gap-1.5">
      {country ? (
        <>
          <span aria-hidden="true">{countryFlag(country.code2)}</span>
          {country.name}
        </>
      ) : (
        row.country || 'Country unknown'
      )}
    </span>,
    <span key="doc">{docTypeLabel(row.doc_type)}</span>,
    <span key="created">Submitted {fmtDate(row.created_at)}</span>,
    ...(row.user_ref ? [<span key="ref">Ref {row.user_ref}</span>] : []),
  ]

  return (
    <>
      <header className="sticky top-14 z-20 border-b border-neutral-800 bg-surface/95 backdrop-blur md:top-0">
        <div className="px-4 pt-4 sm:px-6 md:px-8">
          <Link
            href="/admin/verifications"
            className="mb-2 inline-flex items-center gap-1 rounded text-sm text-neutral-400 transition-colors hover:text-neutral-200"
          >
            <Icons.ChevronLeft className="h-4 w-4" />
            Verifications
          </Link>
          <div className="flex flex-col gap-4 pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-white">Verification #{row.id}</h1>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setTab('overview')} title="See what needs attention">
                    <StatusBadge tone={RESULT_TONE[assessment.kind]}>
                      {assessment.label}
                      {assessment.attentionCount ? ` · ${assessment.attentionCount}` : ''}
                    </StatusBadge>
                  </button>
                  {decision ? <StatusBadge tone={decision.tone}>{decision.label}</StatusBadge> : null}
                  {row.verification_mode ? <SourceChip mode={row.verification_mode} /> : null}
                  {row.deleted_at ? <StatusBadge tone="warning">In Recycle Bin</StatusBadge> : null}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-400">
                {meta.map((item, index) => (
                  <span key={index} className="inline-flex min-w-0 items-center gap-3">
                    {index > 0 ? <span className="h-1 w-1 shrink-0 rounded-full bg-neutral-600" aria-hidden="true" /> : null}
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {row.deleted_at ? null : isSuperAdmin ? (
                <DeletePermanentlyButton
                  size="md"
                  label="Delete"
                  path={`/verifications/${row.id}?confirm=true`}
                  title="Delete this verification permanently?"
                  description="Back-office deletes are immediate on the server — this does not go to the Recycle Bin and cannot be undone. To keep it recoverable, delete it from a firm login instead."
                  onDone={() => router.push('/admin/verifications')}
                />
              ) : (
                <MoveToBinButton size="md" path={`/verifications/${row.id}`} what="this verification" onDone={() => router.push('/admin/verifications')} />
              )}
              <Button variant="secondary" onClick={() => setEdit(edit.editing ? IDLE_EDIT : { ...IDLE_EDIT, editing: true })}>
                {edit.editing ? 'Cancel edit' : 'Edit values'}
              </Button>
              {edit.editing ? (
                <Button variant="secondary" loading={saving === 'save'} disabled={!!saving} onClick={() => submit('save')}>
                  Save changes
                </Button>
              ) : null}
              <Button variant="danger" loading={saving === 'reject'} disabled={!!saving} onClick={() => submit('reject')}>
                Reject
              </Button>
              <Button loading={saving === 'approve'} disabled={!!saving} onClick={() => submit('approve')}>
                <Icons.Check className="h-4 w-4" />
                Approve
              </Button>
            </div>
          </div>
          {row.deleted_at ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <span className="inline-flex items-center gap-2">
                <Icons.Trash className="h-4 w-4 shrink-0" />
                In the Recycle Bin — deleted for good {timeUntilPurge(row.deleted_at)} unless restored.
              </span>
              <RestoreButton path={`/verifications/${row.id}/restore`} onDone={() => void load()} />
            </div>
          ) : null}
          {saveError ? <Notice tone="error" className="mb-4">{saveError}</Notice> : null}
        </div>
        <TabStrip label="Verification review sections" className="px-4 sm:px-6 md:px-8" tabs={tabs} active={tab} onSelect={setTab} />
      </header>

      <div className="px-4 py-6 sm:px-6 md:px-8 md:py-8">
        <div className="mx-auto flex max-w-[1920px] flex-col gap-6 xl:flex-row xl:items-start">
          <aside className="w-full shrink-0 xl:sticky xl:top-48 xl:w-[360px] 2xl:w-[420px]">
            <Evidence row={row} />
          </aside>
          <div className="min-w-0 flex-1 animate-fade-in" key={tab}>
            {tab === 'overview' ? <OverviewTab row={row} edit={edit} setEdit={setEdit} assessment={assessment} onOpen={setTab} /> : null}
            {tab === 'scores' ? <ScoresTab row={row} edit={edit} setEdit={setEdit} /> : null}
            {tab === 'template' ? <TemplateMatchPanel match={row.pipeline_response?.template_match} /> : null}
            {tab === 'mrz' ? <MrzTab row={row} /> : null}
            {tab === 'cross' ? <CrossTab row={row} /> : null}
            {tab === 'forensics' ? (
              row.forensics_result ? (
                <ForensicsView fr={row.forensics_result} />
              ) : (
                <Notice>Forensics are not available yet — a background step writes them a few seconds after submission.</Notice>
              )
            ) : null}
            {tab === 'pep' ? (
              row.pep_result ? (
                <ScreeningResultView result={row.pep_result} kind="person" compactMatches />
              ) : (
                <Notice>PEP and sanctions screening is not available yet — a background step writes it a few seconds after submission.</Notice>
              )
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}
