'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button, Card, CardHeader, EmptyState, Field, Icons, Input } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { Notice, OneTimeSecret, PasswordField, Section, TableSkeletonRows, TD, TH, TR, TR_CLICKABLE, TR_DELETED } from '@/components/admin/kit'
import { DeletePermanentlyButton } from '@/components/admin/recycle'
import { useAdminSession } from '@/components/admin/session-context'
import { apiJson, jsonBody, messageOf } from '@/lib/api'
import type { Firm } from '@/lib/types'
import { cn } from '@/lib/utils/cn'

interface Created {
  name: string
  slug: string
  password: string
  apiKey: string | null
}

/** Firms (tenants) on the live server. Super-admin only — the server enforces it too. */
export default function CompaniesPage() {
  const router = useRouter()
  const { isSuperAdmin, firms, refreshFirms } = useAdminSession()
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)

  useEffect(() => {
    if (!isSuperAdmin) return
    void refreshFirms().finally(() => setLoading(false))
  }, [isSuperAdmin, refreshFirms])

  if (!isSuperAdmin) {
    return <Notice tone="warning">Companies are managed by the back office.</Notice>
  }

  async function create() {
    setError(null)
    const trimmedName = name.trim()
    const trimmedSlug = slug.trim().toLowerCase()
    if (!trimmedName || !trimmedSlug || !password) {
      setError('Firm name, slug and password are all required.')
      return
    }
    setCreating(true)
    try {
      // Checked against a fresh list right before submitting, so a firm
      // added moments ago in another tab is still caught.
      const existing = await apiJson<{ items: Firm[] }>('/firms')
      if (existing.ok) {
        if (existing.data.items.some((f) => f.name.trim().toLowerCase() === trimmedName.toLowerCase())) {
          setError(`A firm named “${trimmedName}” already exists.`)
          return
        }
        if (existing.data.items.some((f) => (f.slug ?? '').toLowerCase() === trimmedSlug)) {
          setError(`The slug “${trimmedSlug}” is already used by another firm.`)
          return
        }
      }
      const result = await apiJson<{ api_key?: string }>('/firms', { method: 'POST', ...jsonBody({ name: trimmedName, slug: trimmedSlug, password }) }, 'Create failed')
      if (!result.ok) {
        setError(result.detail)
        return
      }
      setCreated({ name: trimmedName, slug: trimmedSlug, password, apiKey: result.data.api_key ?? null })
      setName('')
      setSlug('')
      setPassword('')
      await refreshFirms()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Companies" description="The firms on the platform. Each signs in with its slug and password, and calls the API with its own key." />

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="New firm">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Firm name" htmlFor="f-name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Compliance Ltd" />
              </Field>
              <Field label="Slug" htmlFor="f-slug" hint="The firm’s login ID.">
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-compliance" autoCapitalize="none" spellCheck={false} />
              </Field>
            </div>
            <Field label="Head-admin password" htmlFor="f-password">
              <PasswordField id="f-password" value={password} onChange={setPassword} placeholder="Generate or type one" />
            </Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button onClick={create} loading={creating}>
              <Icons.Plus className="h-4 w-4" />
              Create firm
            </Button>
          </div>
        </Section>

        {created ? (
          <Section title="Firm created" description={`${created.name} signs in with these details. Share them with the firm’s head admin now — the password is not shown again.`}>
            <div className="space-y-4">
              <OneTimeSecret label="Firm ID (slug)" value={created.slug} note="No username — that is only for team members the firm adds later." />
              <OneTimeSecret label="Password" value={created.password} />
              {created.apiKey ? <OneTimeSecret label="API key" value={created.apiKey} /> : null}
            </div>
          </Section>
        ) : null}
      </div>

      <Card>
        <CardHeader title="Existing firms" description={`${firms.filter((f) => !f.deleted_at).length} active`} />
        {!loading && firms.length === 0 ? (
          <EmptyState icon={Icons.Building} title="No firms yet." description="Create the first one above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className={TH}>Name</th>
                  <th className={TH}>Slug (login)</th>
                  <th className={TH}>Firm ID</th>
                  <th className={cn(TH, 'text-right')}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeletonRows cols={4} rows={4} />
                ) : (
                  firms.map((firm) => (
                    <tr key={firm.id} className={cn(TR, TR_CLICKABLE, firm.deleted_at && TR_DELETED)} onClick={() => router.push(`/admin/companies/${firm.id}`)}>
                      <td className={cn(TD, 'font-medium text-white')}>{firm.name}</td>
                      <td className={cn(TD, 'font-mono text-[13px]')}>{firm.slug || '—'}</td>
                      <td className={cn(TD, 'tabular-nums text-neutral-400')}>{firm.id}</td>
                      <td className={cn(TD, 'text-right')}>
                        <DeletePermanentlyButton
                          path={`/firms/${firm.id}`}
                          title={`Delete ${firm.name}?`}
                          description="Its logins and API key stop working straight away. Firms are deleted outright on the server — they do not go to the Recycle Bin and cannot be restored. The server refuses while the firm still has verifications on record."
                          label="Delete"
                          onDone={refreshFirms}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
