'use client'

import { useState } from 'react'
import { Button, Field, Icons, Select, StatusBadge } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { CountryInput, InfoGrid, InfoItem, Notice, Section } from '@/components/admin/kit'
import { ForensicsView } from '@/components/admin/forensics'
import { ScreeningResultView } from '@/components/admin/screening'
import { useAdminSession } from '@/components/admin/session-context'
import { apiJson, messageOf } from '@/lib/api'
import { DOC_TYPES, fmtPct, humanize, verdictTone } from '@/lib/format'
import type { ForensicsResult, ScreeningResult } from '@/lib/types'

interface CheckResult {
  country: string
  doc_type: string
  forensics: ForensicsResult | null
  document: { score?: number | null; verdict?: string; refs_checked?: number; error?: string } | null
  mrz: {
    verdict?: string
    error?: string
    raw_lines?: string[]
    checks?: Record<string, boolean>
    fields?: Record<string, string>
  } | null
  ocr_fields: Record<string, string> | null
  pep: ScreeningResult | null
}

function FileInput({ id, file, onChange }: { id: string; file: File | null; onChange: (file: File | null) => void }) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-neutral-700 bg-neutral-950 px-3.5 py-3 text-sm text-neutral-400 transition-colors hover:border-neutral-500"
    >
      <Icons.Image className="h-4 w-4 shrink-0 text-neutral-500" />
      <span className="min-w-0 flex-1 truncate">{file ? file.name : 'Choose an image…'}</span>
      <input id={id} type="file" accept="image/*" className="sr-only" onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
    </label>
  )
}

export default function DocumentCheckPage() {
  const { isSuperAdmin, firmId } = useAdminSession()
  const [docType, setDocType] = useState<string>('passport')
  const [country, setCountry] = useState('')
  const [front, setFront] = useState<File | null>(null)
  const [back, setBack] = useState<File | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckResult | null>(null)

  async function run() {
    setError(null)
    if (!/^[A-Za-z]{2}$/.test(country)) {
      setError('Pick the issuing country from the list.')
      return
    }
    if (!front) {
      setError('Choose an image of the document front (or the passport bio-data page).')
      return
    }
    const form = new FormData()
    form.append('country', country.toUpperCase())
    form.append('doc_type', docType)
    form.append('id_image', front)
    if (back) form.append('id_image_back', back)
    if (isSuperAdmin && firmId) form.append('firm_id', String(firmId))

    setRunning(true)
    setResult(null)
    try {
      const response = await apiJson<CheckResult>('/document-check', { method: 'POST', body: form }, 'Check failed')
      if (response.ok) setResult(response.data)
      else setError(response.detail)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setRunning(false)
    }
  }

  const mrz = result?.mrz
  const doc = result?.document

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Document check"
        description="Spot-check a document on file: authenticity (MRZ check digits for passports, reference-image match for cards), EXIF and tamper analysis, and a PEP & sanctions screen on the name read. No selfie, and nothing is added to the verification list."
      />

      <Section title="Upload">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Document type" htmlFor="doc-type">
              <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
                {DOC_TYPES.map((doc) => (
                  <option key={doc.value} value={doc.value}>
                    {doc.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Issuing country" htmlFor="doc-country">
              <CountryInput value={country} onChange={setCountry} />
            </Field>
            <Field label="Document front / bio-data page" htmlFor="doc-front">
              <FileInput id="doc-front" file={front} onChange={setFront} />
            </Field>
            <Field label="Document back" htmlFor="doc-back" hint="Optional.">
              <FileInput id="doc-back" file={back} onChange={setBack} />
            </Field>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button onClick={run} loading={running}>
            {running ? 'Checking…' : 'Run check'}
          </Button>
        </div>
      </Section>

      {result ? (
        <div className="space-y-6">
          {doc ? (
            <Section
              title="Document reference match"
              action={
                <StatusBadge tone={verdictTone(null, doc.verdict)} className="capitalize">
                  {humanize(doc.verdict || 'unknown')}
                </StatusBadge>
              }
            >
              <div className="space-y-3">
                {doc.error ? <Notice tone="warning">{doc.error}</Notice> : null}
                <InfoGrid>
                  <InfoItem label="Score">{fmtPct(doc.score)}</InfoItem>
                  <InfoItem label="References checked">{doc.refs_checked ?? 0}</InfoItem>
                </InfoGrid>
              </div>
            </Section>
          ) : null}

          {mrz ? (
            !mrz.raw_lines || mrz.raw_lines.length < 2 ? (
              <Section title="MRZ validation">
                <Notice>{mrz.error || 'No machine-readable zone could be read from this image.'}</Notice>
              </Section>
            ) : (
              <Section
                title="MRZ validation"
                action={
                  <StatusBadge tone={verdictTone(null, mrz.verdict)} className="capitalize">
                    {humanize(mrz.verdict || 'unknown')}
                  </StatusBadge>
                }
              >
                <div className="space-y-4">
                  <pre className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3 font-mono text-[13px] leading-relaxed text-neutral-200">
                    {mrz.raw_lines.join('\n')}
                  </pre>
                  <InfoGrid>
                    {Object.entries(mrz.checks ?? {}).map(([key, ok]) => (
                      <InfoItem key={key} label={<span className="capitalize">{humanize(key)}</span>}>
                        <StatusBadge tone={ok ? 'success' : 'danger'}>{ok ? 'Passed' : 'Failed'}</StatusBadge>
                      </InfoItem>
                    ))}
                  </InfoGrid>
                  <InfoGrid>
                    <InfoItem label="Given name">{mrz.fields?.given_names || '—'}</InfoItem>
                    <InfoItem label="Surname">{mrz.fields?.surname || '—'}</InfoItem>
                    <InfoItem label="Date of birth">{mrz.fields?.date_of_birth || '—'}</InfoItem>
                    <InfoItem label="Nationality">{mrz.fields?.nationality || '—'}</InfoItem>
                    <InfoItem label="Expiry">{mrz.fields?.expiry_date || '—'}</InfoItem>
                    <InfoItem label="Document number" mono>
                      {mrz.fields?.passport_number || '—'}
                    </InfoItem>
                  </InfoGrid>
                </div>
              </Section>
            )
          ) : result.ocr_fields && Object.keys(result.ocr_fields).length ? (
            <Section title="Extracted fields">
              <InfoGrid>
                {Object.entries(result.ocr_fields).map(([key, value]) => (
                  <InfoItem key={key} label={<span className="capitalize">{humanize(key)}</span>}>
                    {value || '—'}
                  </InfoItem>
                ))}
              </InfoGrid>
            </Section>
          ) : null}

          {result.forensics ? (
            <ForensicsView fr={result.forensics} full={false} />
          ) : (
            <Section title="Forensics & EXIF">
              <p className="text-sm text-neutral-500">Not available.</p>
            </Section>
          )}

          {result.pep ? (
            <ScreeningResultView result={result.pep} kind="person" compactMatches />
          ) : (
            <Section title="PEP & sanctions">
              <p className="text-sm text-neutral-500">Not available.</p>
            </Section>
          )}
        </div>
      ) : null}
    </div>
  )
}
