'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Card, CardHeader, StatusBadge, type StatusTone } from '@/components/ui'
import { InfoGrid, InfoItem, Notice, TabStrip } from '@/components/admin/kit'
import { fmtPct, humanize } from '@/lib/format'
import type { TemplateMatchSide } from '@/lib/types'
import { cn } from '@/lib/utils/cn'

type View = 'side' | 'overlay' | 'blink'

const VERDICT_TONE: Record<string, StatusTone> = {
  strong_match: 'success',
  likely_match: 'success',
  weak_match: 'warning',
  no_match: 'danger',
}

/**
 * The two frames the engine compared: the customer's card as it saw it —
 * straightened, lighting-normalised, its own personal areas blacked out
 * exactly as they were left out of the score — and the approved template.
 * Same size, same alignment, so the admin can check the comparison instead
 * of taking a number on trust.
 */
function FrameCompare({ card, template }: { card: string; template: string }) {
  const [view, setView] = useState<View>('side')
  const [opacity, setOpacity] = useState(50)
  const [showTemplate, setShowTemplate] = useState(false)

  useEffect(() => {
    if (view !== 'blink') return
    const timer = setInterval(() => setShowTemplate((v) => !v), 700)
    return () => clearInterval(timer)
  }, [view])

  /* eslint-disable @next/next/no-img-element -- data: URIs produced by the AI server */
  return (
    <div className="space-y-3">
      <TabStrip
        label="Comparison view"
        className="border-b border-neutral-800"
        active={view}
        onSelect={setView}
        tabs={[
          { key: 'side', label: 'Side by side' },
          { key: 'overlay', label: 'Overlay' },
          { key: 'blink', label: 'Blink' },
        ]}
      />
      {view === 'side' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <figure className="space-y-1.5">
            <img src={card} alt="Customer's card as compared" className="w-full rounded-lg border border-neutral-800" />
            <figcaption className="text-xs text-neutral-400">This document — aligned, lighting corrected, personal areas blacked out</figcaption>
          </figure>
          <figure className="space-y-1.5">
            <img src={template} alt="Approved template" className="w-full rounded-lg border border-neutral-800" />
            <figcaption className="text-xs text-neutral-400">Approved template</figcaption>
          </figure>
        </div>
      ) : view === 'overlay' ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg border border-neutral-800">
            <img src={card} alt="Customer's card as compared" className="block w-full" />
            <img src={template} alt="Approved template" className="absolute inset-0 h-full w-full" style={{ opacity: opacity / 100 }} />
          </div>
          <label className="flex items-center gap-3 text-xs text-neutral-400">
            This document
            <input type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="range-slider flex-1" />
            Template
          </label>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="relative overflow-hidden rounded-lg border border-neutral-800">
            <img src={card} alt="Customer's card as compared" className="block w-full" />
            <img src={template} alt="Approved template" className={cn('absolute inset-0 h-full w-full transition-opacity duration-100', showTemplate ? 'opacity-100' : 'opacity-0')} />
          </div>
          <p className="text-xs text-neutral-400">
            Showing: <span className="font-medium text-neutral-200">{showTemplate ? 'template' : 'this document'}</span> — anything that jumps is a difference in the design.
          </p>
        </div>
      )}
    </div>
  )
  /* eslint-enable @next/next/no-img-element */
}

function SideResult({ result }: { result: TemplateMatchSide }) {
  const title = `${humanize(result.side).replace(/^./, (c) => c.toUpperCase())} side`
  let summary: React.ReactNode = null
  if (result.status === 'no_templates') {
    summary = (
      <Notice>
        No approved template for this design yet, so this side was not compared.{' '}
        {result.draft?.created ? 'It was offered as a draft template — approve it in Templates to start comparing.' : ''}
      </Notice>
    )
  } else if (result.status === 'insufficient') {
    summary = (
      <Notice tone="warning">
        Too little of the card could be compared ({fmtPct(result.compared_fraction)} of it) — glare, shadow or a poor crop hid the rest. Compare the
        photographs yourself.
      </Notice>
    )
  } else if (result.status === 'no_card') {
    summary = <Notice tone="warning">The card could not be found in this photo, so there was nothing to compare.</Notice>
  } else if (result.status === 'error') {
    summary = <Notice tone="warning">The comparison could not run{result.error ? `: ${result.error}` : ''}.</Notice>
  }

  return (
    <Card>
      <CardHeader
        title={title}
        action={
          result.verdict ? (
            <StatusBadge tone={VERDICT_TONE[result.verdict] ?? 'neutral'} className="capitalize">
              {humanize(result.verdict)} · {fmtPct(result.score)}
            </StatusBadge>
          ) : undefined
        }
      />
      <div className="space-y-5 p-4 sm:p-5">
        {summary}
        {result.status === 'compared' || result.status === 'insufficient' ? (
          <InfoGrid>
            <InfoItem label="Template">
              {result.template_id ? (
                <Link href={`/admin/templates/editor/${result.template_id}`} className="text-brand-400 hover:text-brand-300">
                  {result.template_label || `Template ${result.template_id.slice(0, 6)}`}
                </Link>
              ) : (
                '—'
              )}
              <span className="ml-1 text-xs text-neutral-500">closest of {result.templates_checked} samples</span>
            </InfoItem>
            {result.samples_agreeing != null && result.templates_checked ? (
              <InfoItem label="Samples agreeing">
                {result.samples_agreeing} of {result.templates_checked}
              </InfoItem>
            ) : null}
            <InfoItem label="Design lines agree">{fmtPct(result.components?.orientation)}</InfoItem>
            <InfoItem label="Structure">{fmtPct(result.components?.structure)}</InfoItem>
            <InfoItem label="Colour layout">{result.components?.colour == null ? '—' : fmtPct(result.components.colour)}</InfoItem>
            <InfoItem label="Photo / MRZ position">{result.components?.layout == null ? '—' : fmtPct(result.components.layout)}</InfoItem>
            <InfoItem label="Area compared">{fmtPct(result.compared_fraction)}</InfoItem>
            {result.lighting ? (
              <InfoItem label="Lighting">
                brightness {fmtPct(result.lighting.brightness)} · glare {fmtPct(result.lighting.glare_fraction)}
                {result.lighting.colour_cast > 0.15 ? ' · colour cast corrected' : ''}
              </InfoItem>
            ) : null}
            {result.turned_180 ? <InfoItem label="Orientation">Photo was upside down — turned before comparing</InfoItem> : null}
          </InfoGrid>
        ) : null}
        {result.card_frame && result.template_frame ? <FrameCompare card={result.card_frame} template={result.template_frame} /> : null}
      </div>
    </Card>
  )
}

export function TemplateMatchPanel({ match }: { match: Record<string, TemplateMatchSide> | null | undefined }) {
  const sides = Object.values(match ?? {}).sort((a, b) => (a.side === 'front' ? -1 : b.side === 'front' ? 1 : 0))
  if (!sides.length) {
    return (
      <Notice>
        No template comparison for this verification. It was processed before template matching was switched on, or the AI server did not
        return one.
      </Notice>
    )
  }
  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-neutral-400">
        The document was compared against the approved, redacted templates for its country and type — design only: faces, names, numbers and
        the MRZ are left out on both sides, and lighting is corrected first.
      </p>
      {sides.map((side) => (
        <SideResult key={side.side} result={side} />
      ))}
    </div>
  )
}
