'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button, Field, Input } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { CountryInput, Notice, Section, TabStrip } from '@/components/admin/kit'
import { ScreeningResultView } from '@/components/admin/screening'
import { useAdminSession } from '@/components/admin/session-context'
import { apiJson, jsonBody, messageOf } from '@/lib/api'
import type { ScreeningResult } from '@/lib/types'

type Mode = 'person' | 'company'

/**
 * One AML section, two subjects: a person (PEP & sanctions, the old "PEP &
 * Sanctions Check" page) or a company (sanctions & adverse media, the old
 * "KYB" page). Both call the live OpenSanctions screen and are logged
 * server-side for audit.
 */
export function AmlScreening() {
  const router = useRouter()
  const pathname = usePathname()
  const mode: Mode = useSearchParams().get('tab') === 'company' ? 'company' : 'person'

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="AML screening" description="Screen a person or a company against PEP, sanctions and adverse-media lists." />
      <TabStrip
        label="Screening subject"
        className="border-b border-neutral-800"
        active={mode}
        onSelect={(next) => router.replace(next === 'company' ? `${pathname}?tab=company` : pathname)}
        tabs={[
          { key: 'person', label: 'Person — PEP & sanctions' },
          { key: 'company', label: 'Company — KYB' },
        ]}
      />
      {mode === 'person' ? <PersonScreen key="person" /> : <CompanyScreen key="company" />}
    </div>
  )
}

function useScreen(path: string) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScreeningResult | null>(null)

  async function run(body: Record<string, unknown>) {
    setError(null)
    setRunning(true)
    setResult(null)
    try {
      const response = await apiJson<ScreeningResult>(path, { method: 'POST', ...jsonBody(body) }, 'Screen failed')
      if (response.ok) setResult(response.data)
      else setError(response.detail)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setRunning(false)
    }
  }

  return { running, error, setError, result, run }
}

function PersonScreen() {
  const { isSuperAdmin, firmId } = useAdminSession()
  const [given, setGiven] = useState('')
  const [surname, setSurname] = useState('')
  const [dob, setDob] = useState('')
  const [nationality, setNationality] = useState('')
  const screen = useScreen('/screen')

  function submit() {
    if (!given.trim() && !surname.trim()) {
      screen.setError('Enter at least a first name or a surname.')
      return
    }
    void screen.run({
      given_names: given.trim(),
      surname: surname.trim(),
      date_of_birth: dob || null,
      // Only a resolved alpha-2 code is valid for the audit row's country.
      nationality: nationality || null,
      firm_id: isSuperAdmin ? firmId : null,
    })
  }

  return (
    <>
      <Notice>
        <strong className="font-medium text-neutral-100">Reading a result:</strong> a <strong>PEP</strong> hit confirms the person is a
        recognised political figure — a due-diligence flag required by AML law, not an accusation; expect sitting officials to hit. A{' '}
        <strong>sanctions</strong> hit means a government has legally restricted them — that is the real red flag. Review sanctions first; a
        PEP-only result needs enhanced due diligence noted, not automatic rejection.
      </Notice>
      <Section title="Search">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="First name" htmlFor="s-given">
              <Input value={given} onChange={(e) => setGiven(e.target.value)} placeholder="Nikos" />
            </Field>
            <Field label="Surname" htmlFor="s-surname">
              <Input value={surname} onChange={(e) => setSurname(e.target.value)} placeholder="Christodoulides" />
            </Field>
            <Field label="Date of birth" htmlFor="s-dob" hint="Optional — sharpens the match.">
              <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </Field>
            <Field label="Nationality" htmlFor="s-nationality" hint="Optional.">
              <CountryInput value={nationality} onChange={setNationality} />
            </Field>
          </div>
          {screen.error ? <Notice tone="error">{screen.error}</Notice> : null}
          <Button type="submit" loading={screen.running}>
            {screen.running ? 'Screening…' : 'Run screen'}
          </Button>
        </form>
      </Section>
      {screen.result ? <ScreeningResultView result={screen.result} kind="person" /> : null}
    </>
  )
}

function CompanyScreen() {
  const { isSuperAdmin, firmId } = useAdminSession()
  const [name, setName] = useState('')
  const [jurisdiction, setJurisdiction] = useState('')
  const [registration, setRegistration] = useState('')
  const screen = useScreen('/screen-company')

  function submit() {
    if (!name.trim()) {
      screen.setError('Enter a company name.')
      return
    }
    void screen.run({
      company_name: name.trim(),
      jurisdiction: jurisdiction || null,
      registration_number: registration.trim() || null,
      firm_id: isSuperAdmin ? firmId : null,
    })
  }

  return (
    <>
      <Notice>
        <strong className="font-medium text-neutral-100">Reading a result:</strong> a <strong>sanctions</strong> hit means a government has
        legally restricted this company — the real red flag. An <strong>adverse media</strong> hit means negative-linked reporting exists
        (leaks, disqualifications, investigations) — worth reviewing, but not a legal designation on its own.
      </Notice>
      <Section title="Search">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Company name" htmlFor="k-name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Holdings Ltd" />
            </Field>
            <Field label="Jurisdiction" htmlFor="k-jurisdiction" hint="Optional.">
              <CountryInput value={jurisdiction} onChange={setJurisdiction} />
            </Field>
            <Field label="Registration number" htmlFor="k-reg" hint="Optional.">
              <Input value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="HE123456" />
            </Field>
          </div>
          {screen.error ? <Notice tone="error">{screen.error}</Notice> : null}
          <Button type="submit" loading={screen.running}>
            {screen.running ? 'Screening…' : 'Run screen'}
          </Button>
        </form>
      </Section>
      {screen.result ? <ScreeningResultView result={screen.result} kind="company" subjectLabel="Subject company" /> : null}
    </>
  )
}
