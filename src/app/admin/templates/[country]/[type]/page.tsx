'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Card, CardHeader, EmptyState, Icons, LoadingState, StatusBadge } from '@/components/ui'
import { InfoGrid, InfoItem, Notice, Section } from '@/components/admin/kit'
import { SourceChip } from '@/components/admin/source-chip'
import { decisionOf, listFinding } from '@/lib/assess'
import { docTypeLabel, fmtDate, fmtDay, humanize } from '@/lib/format'
import { rowName, useResolvedNames } from '@/lib/identity'
import { isGap, loadProfile, PROFILE_FIELDS, type DesignProfile } from '@/lib/templates'
import { cn } from '@/lib/utils/cn'
import { Breadcrumbs, countryFlag, countryName, DOC_TYPE_ICON, useRegistry } from '@/app/admin/templates/shared'
import { DesignTemplates } from '@/components/admin/template-cards'

function share(count: number | undefined, of: number): string {
  if (!of) return '—'
  return `${Math.round(((count ?? 0) / of) * 100)}%`
}

function Bar({ value, of }: { value: number; of: number }) {
  const pct = of ? Math.round((value / of) * 100) : 0
  const tone = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-neutral-400">
        {value} of {of}
      </span>
    </div>
  )
}

function breakdown(counts: Record<string, number>, label: (k: string) => string = humanize): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return entries.length ? entries.map(([k, n]) => `${label(k)} (${n})`).join(', ') : '—'
}

/**
 * One document design, as the documents received describe it: how often it
 * arrives, whether a reference design is on file, where its MRZ sits and how
 * cleanly it reads, which fields come out reliably — and the documents
 * themselves.
 */
export default function DesignPage() {
  const params = useParams<{ country: string; type: string }>()
  const country = params.country.toUpperCase()
  const docType = params.type
  const { registry, error } = useRegistry()
  const design = registry?.designs.find((d) => d.country === country && d.docType === docType)
  const [profile, setProfile] = useState<DesignProfile | null>(null)
  const names = useResolvedNames(design?.rows.slice(0, 10))

  useEffect(() => {
    if (!design) return
    let cancelled = false
    setProfile(null)
    loadProfile(design).then((p) => !cancelled && setProfile(p))
    return () => {
      cancelled = true
    }
  }, [design])

  const Icon = DOC_TYPE_ICON[docType] ?? DOC_TYPE_ICON.national_id!
  const crumbs = (
    <Breadcrumbs
      trail={[
        { label: 'All countries', href: '/admin/templates' },
        { label: countryName(country), flag: countryFlag(country), href: `/admin/templates/${country}` },
        { label: docTypeLabel(docType) },
      ]}
    />
  )

  if (error) {
    return (
      <>
        {crumbs}
        <Notice tone="error">{error}</Notice>
      </>
    )
  }
  if (!registry) return <LoadingState title="Loading document design" />
  if (!design) {
    return (
      <>
        {crumbs}
        <Card>
          <EmptyState
            icon={Icon}
            title="None received yet."
            description={`No ${docTypeLabel(docType).toLowerCase()} from ${countryName(country)} has come in. It appears here with the first one.`}
          />
        </Card>
      </>
    )
  }

  const gap = isGap(design)
  const matched = profile ? Object.entries(profile.documentMatch).filter(([k]) => k !== 'no_refs' && k !== 'error').reduce((n, [, c]) => n + c, 0) : 0

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        {crumbs}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950">
              <Icon className="h-5 w-5 text-neutral-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                {docTypeLabel(docType)}
                <span className="ml-2 text-base font-normal text-neutral-500">{countryName(country)}</span>
              </h1>
              <p className="mt-0.5 text-sm text-neutral-400">
                {design.received} received · first {fmtDay(design.firstSeen)} · last {fmtDay(design.lastSeen)}
              </p>
            </div>
          </div>
          <Link
            href={`/admin/verifications?country=${country}&doc_type=${docType}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 text-sm font-medium text-neutral-100 hover:bg-neutral-700"
          >
            {design.received === 1 ? 'Open its verification' : `All ${design.received} verifications`}
            <Icons.ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {gap ? (
        <Notice tone="warning">
          <strong className="font-medium text-amber-100">No reference design on file.</strong> Every {docTypeLabel(docType).toLowerCase()} from{' '}
          {countryName(country)} so far arrived with nothing to compare it against, so the design itself has not been checked — only the face and
          the MRZ. Reference images for this design need adding to the verification server.
        </Notice>
      ) : null}

      <DesignTemplates country={country} docType={docType} rows={design.rows} />

      <Section title="Received">
        <InfoGrid>
          <InfoItem label="Documents">{design.received}</InfoItem>
          <InfoItem label="Passed checks">{design.passed}</InfoItem>
          <InfoItem label="Flagged">{design.flagged}</InfoItem>
          <InfoItem label="Capture">
            <span className="flex flex-wrap gap-1.5">
              {Object.keys(design.modes).length
                ? Object.entries(design.modes).map(([mode, n]) => (
                    <span key={mode} className="inline-flex items-center gap-1">
                      <SourceChip mode={Number(mode)} /> <span className="text-xs text-neutral-500">{n}</span>
                    </span>
                  ))
                : '—'}
            </span>
          </InfoItem>
          <InfoItem label="Reference design">
            {gap ? (
              <StatusBadge tone="warning">Not on file</StatusBadge>
            ) : design.unidentified ? (
              <StatusBadge tone="warning">
                Missing for {design.unidentified} of {design.received}
              </StatusBadge>
            ) : (
              <StatusBadge tone="success">On file</StatusBadge>
            )}
          </InfoItem>
        </InfoGrid>
      </Section>

      {!profile ? (
        <Card>
          <LoadingState title="Reading the latest documents" description="Checking how this design reads — its MRZ, its fields, its reference match." />
        </Card>
      ) : (
        <>
          <p className="text-xs text-neutral-500">
            The sections below are read from the newest {profile.sampled} document{profile.sampled === 1 ? '' : 's'} of this design.
          </p>

          <div className="grid gap-6 xl:grid-cols-2">
            <Section title="Machine-readable zone">
              <InfoGrid className="sm:grid-cols-2 xl:grid-cols-2">
                <InfoItem label="Read">{profile.mrzRead ? `${profile.mrzRead} of ${profile.sampled}` : 'Never read'}</InfoItem>
                <InfoItem label="Format">{breakdown(profile.mrzFormats, (k) => k)}</InfoItem>
                <InfoItem label="Found on">{breakdown(profile.mrzSides)}</InfoItem>
                <InfoItem label="Expected on">{profile.expectedSide ?? 'Not set for this design'}</InfoItem>
                <InfoItem label="Check digits all pass">{profile.mrzRead ? share(profile.checkDigitsClean, profile.mrzRead) : '—'}</InfoItem>
              </InfoGrid>
            </Section>

            <Section title="Reference design match">
              <InfoGrid className="sm:grid-cols-2 xl:grid-cols-2">
                <InfoItem label="Compared against a reference">{`${matched} of ${profile.sampled}`}</InfoItem>
                <InfoItem label="Results">{breakdown(profile.documentMatch)}</InfoItem>
              </InfoGrid>
            </Section>
          </div>

          <Section title="Fields read" description="How often each identity field came out of this design — low rates point at a layout the reader struggles with.">
            <dl className="space-y-3">
              {PROFILE_FIELDS.map(([key, label]) => (
                <div key={key} className="grid grid-cols-[9rem_1fr] items-center gap-3">
                  <dt className="text-sm text-neutral-300">{label}</dt>
                  <dd>
                    <Bar value={profile.fieldsRead[key] ?? 0} of={profile.sampled} />
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          {profile.samples.length ? (
            <Section title="Samples" description="The latest documents of this design. Open one to see its full review.">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {profile.samples.map((sample) => (
                  <Link
                    key={sample.id}
                    href={`/admin/verifications/${sample.id}`}
                    className="group overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 transition-colors hover:border-neutral-600"
                  >
                    {/* Short-lived signed storage URLs, served from another host. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sample.front ?? sample.back ?? ''} alt={`Verification ${sample.id}`} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                    <span className="block px-3 py-2 text-xs text-neutral-400 group-hover:text-neutral-200">
                      #{sample.id} · {fmtDay(sample.created)}
                    </span>
                  </Link>
                ))}
              </div>
            </Section>
          ) : null}
        </>
      )}

      <Card>
        <CardHeader title="Latest verifications" />
        <ul className="divide-y divide-neutral-800/60">
          {design.rows.slice(0, 10).map((row) => {
            const finding = decisionOf(row) ?? listFinding(row)
            return (
              <li key={row.id}>
                <Link href={`/admin/verifications/${row.id}`} className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-neutral-800/30 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-neutral-100">{rowName(row, names) || row.user_ref || `Verification #${row.id}`}</span>
                    <span className="block text-xs text-neutral-500">
                      #{row.id} · {fmtDate(row.created_at)}
                    </span>
                  </span>
                  <StatusBadge tone={finding.tone}>{finding.label}</StatusBadge>
                  <Icons.ChevronRight className="h-4 w-4 shrink-0 text-neutral-600" />
                </Link>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
