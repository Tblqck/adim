'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, CardHeader, ConfirmDialog, Field, Icons, Input, LoadingState, Select, StatusBadge, useToast } from '@/components/ui'
import { InfoGrid, InfoItem, Notice, TabStrip } from '@/components/admin/kit'
import { BoxEditor, type EditableBox } from '@/components/admin/box-editor'
import { useAdminSession } from '@/components/admin/session-context'
import { messageOf } from '@/lib/api'
import {
  approveTemplate,
  BOX_KIND_LABEL,
  DEFAULT_SLOTS,
  listTemplates,
  deleteTemplate,
  getTemplate,
  relabelTemplate,
  saveBoxes,
  templateImageUrl,
  templateServiceMissing,
} from '@/lib/design-templates'
import { docTypeLabel, fmtDate, humanize } from '@/lib/format'
import type { DesignTemplate, TemplateBox } from '@/lib/types'
import { cn } from '@/lib/utils/cn'
import { Breadcrumbs, countryFlag, countryName } from '@/app/admin/templates/shared'

function toEditable(t: DesignTemplate): EditableBox[] {
  return t.boxes.map((b, i) => ({ ...b, key: `b${i}`, locked: t.status === 'active' }))
}

function strip(boxes: EditableBox[]): TemplateBox[] {
  return boxes.map(({ kind, x, y, w, h, note }) => ({ kind, x, y, w, h, note }))
}

/**
 * The template editor — 3100's template review, for redacted cards.
 *
 * A draft shows what the redaction removed; the admin checks that nothing
 * personal survived (a signature, a ghost photo, a code the detectors
 * missed), adjusts the boxes, and approves it. Until then the engine does
 * not use it. A draft still has the customer's original, so boxes can be
 * moved or shrunk and the redaction re-rendered; an approved template has
 * only the redacted card, so boxes can be added but not taken away.
 */
export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()
  const { isSuperAdmin, refreshTemplateReviews } = useAdminSession()
  const [template, setTemplate] = useState<DesignTemplate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [boxes, setBoxes] = useState<EditableBox[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'redacted' | 'original' | 'boxes'>('redacted')
  const [version, setVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [label, setLabel] = useState('')
  const [confirm, setConfirm] = useState<'approve' | 'delete' | null>(null)
  // The design side's slots, read when the approve dialog opens: a full side
  // means the back office picks which approved sample this one replaces.
  const [slotState, setSlotState] = useState<{ slots: number; samples: DesignTemplate[] } | null>(null)
  const [replaceId, setReplaceId] = useState<string | null>(null)

  useEffect(() => {
    if (confirm !== 'approve' || !template) return
    setSlotState(null)
    setReplaceId(null)
    listTemplates({ country: template.country, doc_type: template.doc_type, status: 'active' })
      .then((r) => {
        if (!r.ok) return
        setSlotState({ slots: r.data.slots ?? DEFAULT_SLOTS, samples: r.data.items.filter((t) => t.side === template.side) })
      })
      .catch(() => undefined)
  }, [confirm, template])
  const slotsFull = !!slotState && slotState.samples.length >= slotState.slots

  const load = useCallback(async () => {
    try {
      const result = await getTemplate(id)
      if (result.ok) {
        setTemplate(result.data)
        setBoxes(toEditable(result.data))
        setLabel(result.data.label ?? '')
        setVersion(Date.now())
      } else {
        setMissing(templateServiceMissing(result))
        setError(result.detail)
      }
    } catch (err) {
      setError(messageOf(err))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = useMemo(() => template && JSON.stringify(strip(boxes)) !== JSON.stringify(strip(toEditable(template))), [boxes, template])
  const selectedBox = boxes.find((b) => b.key === selected) ?? null
  const canEdit = isSuperAdmin

  async function save() {
    setSaving(true)
    const result = await saveBoxes(id, strip(boxes)).catch(() => null)
    setSaving(false)
    if (result?.ok) {
      toast('Redaction updated')
      setTemplate(result.data)
      setBoxes(toEditable(result.data))
      setVersion(Date.now())
    } else if (result) toast(result.detail, 'error')
  }

  if (error && !template) {
    return (
      <>
        <Link href="/admin/templates" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200">
          <Icons.ChevronLeft className="h-4 w-4" />
          Templates
        </Link>
        <Notice tone={missing ? 'warning' : 'error'}>
          {missing ? 'The template service is not connected yet — see the Templates page for what is needed.' : error}
        </Notice>
      </>
    )
  }
  if (!template) return <LoadingState title="Loading template" />

  const isDraft = template.status === 'draft'
  const imageSrc =
    view === 'original' && isDraft && template.has_original ? templateImageUrl(id, 'original', version) : templateImageUrl(id, 'redacted', version)

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <Breadcrumbs
          trail={[
            { label: 'All countries', href: '/admin/templates' },
            { label: countryName(template.country), flag: countryFlag(template.country), href: `/admin/templates/${template.country}` },
            { label: docTypeLabel(template.doc_type), href: `/admin/templates/${template.country}/${template.doc_type}` },
            { label: `${humanize(template.side)} · ${template.label || template.id.slice(0, 6)}` },
          ]}
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {docTypeLabel(template.doc_type)} {humanize(template.side)}
              <StatusBadge tone={isDraft ? 'warning' : 'success'}>{isDraft ? 'Draft — awaiting approval' : 'Approved'}</StatusBadge>
            </h1>
            <p className="mt-1 text-sm text-neutral-400">
              {countryName(template.country)} · {template.label || 'no version label'} · created {fmtDate(template.created_at)}
            </p>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!dirty} loading={saving} onClick={save}>
                Save boxes
              </Button>
              {isDraft ? (
                <Button disabled={!!dirty} onClick={() => setConfirm('approve')} title={dirty ? 'Save the boxes first' : undefined}>
                  <Icons.Check className="h-4 w-4" />
                  Approve
                </Button>
              ) : null}
              <Button variant="danger" onClick={() => setConfirm('delete')}>
                <Icons.Trash className="h-4 w-4" />
                {isDraft ? 'Reject draft' : 'Drop from slot'}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {isDraft && template.reason ? <Notice tone="warning">{template.reason}</Notice> : null}
      {isDraft ? (
        <Notice>
          Check that nothing personal is left visible — a signature, a faint second photo, a code or number the detectors missed. Draw a box
          over anything that is. The engine does not use this template until it is approved, and the unredacted original is deleted the moment
          it is approved or rejected.
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="border-b border-neutral-800 px-4 pt-3 sm:px-5">
            <TabStrip
              label="Image"
              active={view}
              onSelect={setView}
              tabs={[
                { key: 'redacted', label: 'Redacted template' },
                ...(isDraft && template.has_original ? [{ key: 'original' as const, label: 'Original (draft only)' }] : []),
                { key: 'boxes', label: 'Without boxes' },
              ]}
            />
          </div>
          <div className="p-4 sm:p-5">
            <BoxEditor
              src={imageSrc}
              boxes={boxes}
              onChange={canEdit ? setBoxes : () => undefined}
              selected={selected}
              onSelect={setSelected}
              showBoxes={view !== 'boxes'}
            />
            <p className="mt-2 text-xs text-neutral-500">
              {canEdit ? 'Drag on the card to add a box. Drag a box to move it, its corner to resize it; Delete removes the selected box.' : 'Read only.'}
              {!isDraft && canEdit ? ' This template is approved: its existing boxes are locked, new ones can be added.' : ''}
            </p>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title={selectedBox ? 'Selected box' : 'Boxes'} />
            <div className="space-y-4 p-4 sm:p-5">
              {selectedBox ? (
                <>
                  <Field label="What it covers" htmlFor="box-kind">
                    <Select
                      value={selectedBox.kind}
                      disabled={!canEdit || selectedBox.locked}
                      onChange={(e) => setBoxes(boxes.map((b) => (b.key === selectedBox.key ? { ...b, kind: e.target.value as TemplateBox['kind'] } : b)))}
                    >
                      {Object.entries(BOX_KIND_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {canEdit && !selectedBox.locked ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setBoxes(boxes.filter((b) => b.key !== selectedBox.key))
                        setSelected(null)
                      }}
                    >
                      <Icons.Trash className="h-4 w-4" />
                      Remove box
                    </Button>
                  ) : null}
                </>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(BOX_KIND_LABEL).map(([k, v]) => {
                    const n = boxes.filter((b) => b.kind === k).length
                    return n ? (
                      <li key={k} className="flex justify-between text-neutral-300">
                        <span>{v}</span>
                        <span className="tabular-nums text-neutral-500">{n}</span>
                      </li>
                    ) : null
                  })}
                </ul>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Template" />
            <div className="space-y-4 p-4 sm:p-5">
              {canEdit ? (
                <Field label="Version label" htmlFor="tpl-label" hint="e.g. “2023 polycarbonate card”">
                  <div className="flex gap-2">
                    <Input value={label} onChange={(e) => setLabel(e.target.value)} />
                    {!isDraft ? (
                      <Button
                        variant="secondary"
                        disabled={label === (template.label ?? '')}
                        onClick={async () => {
                          const r = await relabelTemplate(id, label)
                          if (r.ok) {
                            setTemplate(r.data)
                            toast('Label saved')
                          } else toast(r.detail, 'error')
                        }}
                      >
                        Save
                      </Button>
                    ) : null}
                  </div>
                </Field>
              ) : null}
              <InfoGrid className="sm:grid-cols-1 xl:grid-cols-1">
                <InfoItem label="Source">{template.source || '—'}</InfoItem>
                {template.approved_at ? (
                  <InfoItem label="Approved">
                    {fmtDate(template.approved_at)} by {template.approved_by}
                  </InfoItem>
                ) : null}
                <InfoItem label="Documents matched">{template.match_count}</InfoItem>
                <InfoItem label="Last matched">{fmtDate(template.last_matched)}</InfoItem>
              </InfoGrid>
            </div>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === 'approve'}
        onClose={() => setConfirm(null)}
        confirmVariant="primary"
        confirmLabel={slotsFull ? 'Approve and replace' : 'Approve'}
        confirmDisabled={!slotState || (slotsFull && !replaceId)}
        title="Approve this sample?"
        description={
          !slotState
            ? 'Checking this design’s sample slots…'
            : slotsFull
              ? `All ${slotState.slots} sample slots for this ${humanize(template.side)} are full. Choose the sample this one replaces — it is deleted, and documents are compared against the new one from the next verification.`
              : `It takes slot ${slotState.samples.length + 1} of ${slotState.slots} for this ${humanize(template.side)}. Documents are compared against it from the next verification. The unredacted original is deleted now — after this, boxes can only be added.`
        }
        onConfirm={async () => {
          const r = await approveTemplate(id, label.trim() || null, slotsFull ? replaceId : null)
          setConfirm(null)
          if (r.ok) {
            toast(slotsFull ? 'Sample approved — it replaced the one you chose' : 'Sample approved')
            setTemplate(r.data)
            setBoxes(toEditable(r.data))
            setView('redacted')
            void refreshTemplateReviews()
          } else toast(r.detail, 'error')
        }}
      >
        {slotsFull && slotState ? (
          <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {slotState.samples.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setReplaceId(t.id)}
                aria-pressed={replaceId === t.id}
                className={cn(
                  'overflow-hidden rounded-lg border text-left transition-colors',
                  replaceId === t.id ? 'border-rose-500 ring-2 ring-rose-500/50' : 'border-neutral-800 hover:border-neutral-600',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- relay-served, cookie-authenticated */}
                <img src={templateImageUrl(t.id)} alt="" className="aspect-[1.58] w-full object-cover" />
                <span className="block px-2 py-1.5 text-xs text-neutral-300">
                  {t.label || t.id.slice(0, 6)}
                  <span className="block text-neutral-500">{t.match_count} matched · last {fmtDate(t.last_matched)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        confirmLabel={isDraft ? 'Reject draft' : 'Drop sample'}
        title={isDraft ? 'Reject this draft?' : 'Drop this sample from its slot?'}
        description={
          isDraft
            ? 'It is deleted with its original. The document it came from is not affected.'
            : 'Documents are no longer compared against it. It is deleted from the AI server.'
        }
        onConfirm={async () => {
          const r = await deleteTemplate(id)
          setConfirm(null)
          if (r.ok) {
            toast(isDraft ? 'Draft rejected' : 'Sample dropped from its slot')
            void refreshTemplateReviews()
            router.push(`/admin/templates/${template.country}/${template.doc_type}`)
          } else toast(r.detail, 'error')
        }}
      />
    </div>
  )
}
