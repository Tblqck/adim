'use client'

import { useState } from 'react'
import { StatusBadge, type StatusTone } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import { countryLabel } from '@/lib/countries'
import { fmtPct, riskTone } from '@/lib/format'
import type { DatabaseEntry, ScreeningMatch, ScreeningResult } from '@/lib/types'
import { InfoGrid, InfoItem, Notice, Section, TabStrip } from '@/components/admin/kit'

// ── OpenSanctions vocabulary, in plain language ─────────────────────────
// Raw output is topic codes, ISO codes and dataset ids aimed at compliance
// software, not at the person reading a result.

const TOPIC_LABELS: Record<string, string> = {
  sanction: 'Sanctioned',
  'sanction.linked': 'Linked to a Sanctioned Entity',
  'sanction.counter': 'Counter-Sanctioned',
  'role.pep': 'Politically Exposed Person',
  'role.rca': 'Close Associate of a PEP',
  'role.pol': 'Political Office Holder',
  'role.oligarch': 'Oligarch',
  poi: 'Adverse Media',
  debarment: 'Debarred From Public Contracts',
  'corp.disqual': 'Disqualified Company Director',
  'corp.public': 'Publicly Listed Company',
  'gov.soe': 'State-Owned Enterprise',
  'fin.bank': 'Bank / Financial Institution',
  crime: 'Criminal Association',
  'crime.boss': 'Organized Crime',
  'crime.fin': 'Financial Crime',
  'crime.fraud': 'Fraud',
  'crime.terror': 'Terrorism',
  'crime.theft': 'Theft',
  'crime.traffick': 'Trafficking',
  'crime.war': 'War Crimes',
  'export.control': 'Export-Controlled',
  'export.risk': 'Export Control Risk',
  'reg.action': 'Regulatory Action Taken',
  'reg.warn': 'Regulatory Warning',
  wanted: 'Wanted by Law Enforcement',
  'asset.frozen': 'Assets Frozen',
}

function humanizeTopic(code: string): string {
  return TOPIC_LABELS[code] ?? code.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function topicTone(code: string): StatusTone {
  if (code.startsWith('sanction') || code.startsWith('crime') || code === 'wanted' || code === 'asset.frozen') return 'danger'
  if (code.startsWith('role.') || code === 'poi' || code.startsWith('reg.') || code === 'debarment') return 'warning'
  return 'brand'
}

// ── Databases checked ────────────────────────────────────────────────────

const DB_CATEGORY_LABELS = {
  pep: 'Politically Exposed Persons (PEP)',
  sanctions: 'Global Sanctions',
  adverse_media: 'Adverse Media',
} as const
type DbCategory = keyof typeof DB_CATEGORY_LABELS
const DB_CATEGORY_ORDER: DbCategory[] = ['pep', 'sanctions', 'adverse_media']

export function DatabaseCard({ db, showStatus }: { db: DatabaseEntry; showStatus?: boolean }) {
  const tone: StatusTone = db.status === 'HIT' ? 'danger' : db.status === 'UNAVAILABLE' ? 'muted' : 'success'
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-medium text-white">{db.name}</h4>
        {showStatus && db.status ? <StatusBadge tone={tone}>{db.status}</StatusBadge> : null}
      </div>
      <p className="text-xs text-neutral-400">Agency: {db.agency}</p>
      <div className="mt-auto flex flex-wrap gap-2 pt-1 text-[11px] text-neutral-400">
        <span className="rounded-full border border-neutral-800 px-2 py-0.5">{db.region}</span>
        <span className="rounded-full border border-neutral-800 px-2 py-0.5">Added {db.added}</span>
      </div>
    </div>
  )
}

/**
 * A flat `databases_checked` list grouped back into the same three tabs the
 * AML settings (catalog) page shows, so a result and the registry always
 * look like the same view of the same data. Each tab's count shows what it
 * holds — hits out of lists checked.
 */
export function DatabasesChecked({ databases, showStatus = true }: { databases: DatabaseEntry[] | undefined; showStatus?: boolean }) {
  const grouped: Partial<Record<DbCategory, DatabaseEntry[]>> = {}
  for (const db of databases ?? []) {
    const category = (db.category ?? 'sanctions') as DbCategory
    ;(grouped[category] ??= []).push(db)
  }
  const categories = DB_CATEGORY_ORDER.filter((c) => (grouped[c] ?? []).length)
  const [active, setActive] = useState<DbCategory | undefined>(categories[0])
  const current = active && categories.includes(active) ? active : categories[0]

  if (!current) return <p className="text-sm text-neutral-500">No databases were reported for this check.</p>

  return (
    <div className="space-y-4">
      <TabStrip
        label="Database categories"
        className="border-b border-neutral-800"
        active={current}
        onSelect={setActive}
        tabs={categories.map((category) => {
          const items = grouped[category] ?? []
          const hits = items.filter((d) => d.status === 'HIT').length
          return {
            key: category,
            label: (
              <>
                {DB_CATEGORY_LABELS[category]}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[11px]',
                    showStatus && hits > 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-neutral-800 text-neutral-400',
                  )}
                >
                  {showStatus ? `${hits}/${items.length} hit` : `${items.length} lists`}
                </span>
              </>
            ),
          }
        })}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(grouped[current] ?? []).map((db) => (
          <DatabaseCard key={`${db.category}-${db.name}`} db={db} showStatus={showStatus} />
        ))}
      </div>
    </div>
  )
}

// ── One matched profile ──────────────────────────────────────────────────

export function MatchCard({ match, facts }: { match: ScreeningMatch; facts: { label: string; value: string | null | undefined }[] }) {
  const links = [
    ...(match.source_urls ?? []).map((url, i, all) => ({ url, label: all.length > 1 ? `Verify source ${i + 1}` : 'Verify source' })),
    ...(match.wikipedia_url ? [{ url: match.wikipedia_url, label: 'Wikipedia' }] : []),
  ]
  const shownFacts = facts.filter((f) => f.value)

  return (
    <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-base font-medium text-white">{match.name}</p>
        <span className="text-sm font-medium text-neutral-300">{fmtPct(match.score)} match</span>
      </div>
      {match.topics?.length ? (
        <div className="flex flex-wrap gap-2">
          {match.topics.map((topic) => (
            <StatusBadge key={topic} tone={topicTone(topic)}>
              {humanizeTopic(topic)}
            </StatusBadge>
          ))}
        </div>
      ) : null}
      {shownFacts.length ? (
        <InfoGrid>
          {shownFacts.map((fact) => (
            <InfoItem key={fact.label} label={fact.label}>
              {fact.value}
            </InfoItem>
          ))}
        </InfoGrid>
      ) : null}
      {match.notes ? <p className="text-sm leading-relaxed text-neutral-400">{match.notes}</p> : null}
      {links.length ? (
        <div className="flex flex-wrap gap-2">
          {links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 text-sm text-neutral-100 hover:bg-neutral-700"
            >
              {link.label}
            </a>
          ))}
        </div>
      ) : null}
      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer select-none hover:text-neutral-300">
          Technical details — {(match.datasets ?? []).length} source lists
        </summary>
        <div className="mt-2 space-y-1 font-mono leading-relaxed">
          <p>Source lists: {(match.datasets ?? []).join(', ') || '—'}</p>
          <p>Topic codes: {(match.topics ?? []).join(', ') || '—'}</p>
          {match.program_ids?.length ? <p>Sanctions programme codes: {match.program_ids.join(', ')}</p> : null}
        </div>
      </details>
    </div>
  )
}

export function personFacts(match: ScreeningMatch) {
  return [
    { label: 'Country', value: countryLabel(match.country) },
    { label: 'Position / role', value: match.position },
    { label: 'Date of birth', value: match.birth_date },
  ]
}

export function companyFacts(match: ScreeningMatch) {
  return [
    { label: 'Jurisdiction', value: countryLabel(match.jurisdiction || match.country) },
    { label: 'Entity type', value: match.entity_type },
    { label: 'Status', value: match.status },
    { label: 'Registration number', value: match.registration_number },
    { label: 'Incorporated', value: match.incorporation_date },
    { label: 'Website', value: match.website },
    { label: 'Address', value: match.address },
  ]
}

// ── A whole screening result ─────────────────────────────────────────────

export function RiskBanner({ result }: { result: ScreeningResult }) {
  const tone = riskTone(result.risk_classification)
  const style =
    tone === 'success'
      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
      : tone === 'warning'
        ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
        : 'border-neutral-700 bg-neutral-900 text-neutral-300'
  return (
    <div className={cn('rounded-xl border px-4 py-3.5', style)}>
      <p className="text-sm font-medium">{result.banner || result.risk_classification || 'No result'}</p>
      <p className="mt-0.5 text-xs opacity-80">{fmtPct(result.match_confidence)} match confidence</p>
    </div>
  )
}

export function ScreeningResultView({
  result,
  kind,
  subjectLabel = 'Subject name',
  compactMatches = false,
}: {
  result: ScreeningResult
  kind: 'person' | 'company'
  subjectLabel?: string
  /** The automated check on a verification lists matches briefly. */
  compactMatches?: boolean
}) {
  return (
    <div className="space-y-6">
      <Section title="Result">
        <div className="space-y-4">
          <InfoGrid>
            <InfoItem label={subjectLabel}>{result.subject_name || '—'}</InfoItem>
            <InfoItem label="Risk classification">
              <StatusBadge tone={riskTone(result.risk_classification)}>{result.risk_classification ?? '—'}</StatusBadge>
            </InfoItem>
          </InfoGrid>
          <RiskBanner result={result} />
          {result.error ? <Notice tone="error">{result.error}</Notice> : null}
          {result.summary ? <p className="text-sm leading-relaxed text-neutral-300">{result.summary}</p> : null}
        </div>
      </Section>

      {result.matches?.length ? (
        <Section title="Matches" description={`${result.matches.length} candidate${result.matches.length === 1 ? '' : 's'} returned`}>
          {compactMatches ? (
            <InfoGrid>
              {result.matches.map((match, i) => (
                <InfoItem key={i} label={(match.datasets ?? []).join(', ') || 'Match'}>
                  {match.name} — {fmtPct(match.score)}
                </InfoItem>
              ))}
            </InfoGrid>
          ) : (
            <div className="space-y-4">
              {result.matches.map((match, i) => (
                <MatchCard key={i} match={match} facts={kind === 'person' ? personFacts(match) : companyFacts(match)} />
              ))}
            </div>
          )}
        </Section>
      ) : null}

      <Section title="Databases checked">
        <DatabasesChecked databases={result.databases_checked} />
      </Section>
    </div>
  )
}
