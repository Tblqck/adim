'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button, ConfirmDialog, Icons, LoadingState, useToast } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { InfoGrid, InfoItem, Notice, Section } from '@/components/admin/kit'
import { ApiKeyPanel } from '@/components/admin/api-key-panel'
import { useAdminSession } from '@/components/admin/session-context'
import { apiJson, messageOf } from '@/lib/api'

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const firmId = Number(id)
  const { toast } = useToast()
  const { isSuperAdmin, firms, refreshFirms } = useAdminSession()
  const [loading, setLoading] = useState(true)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  useEffect(() => {
    void refreshFirms().finally(() => setLoading(false))
  }, [refreshFirms])

  const firm = firms.find((f) => f.id === firmId)

  if (!isSuperAdmin) return <Notice tone="warning">Companies are managed by the back office.</Notice>
  if (loading && !firm) return <LoadingState title="Loading firm" />

  const back = (
    <Link href="/admin/companies" className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200">
      <Icons.ChevronLeft className="h-4 w-4" />
      Companies
    </Link>
  )

  if (!firm) {
    return (
      <>
        {back}
        <Notice tone="error">Firm not found.</Notice>
      </>
    )
  }

  async function revokeSessions() {
    try {
      const result = await apiJson<{ ok: boolean }>(`/firms/${firmId}/revoke-sessions`, { method: 'POST' }, 'Could not sign the firm out')
      if (result.ok) toast(`Everyone at ${firm?.name} was signed out`)
      else toast(result.detail, 'error')
    } catch (err) {
      const message = messageOf(err)
      if (message) toast(message, 'error')
    } finally {
      setConfirmRevoke(false)
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        {back}
        <PageHeader title={firm.name} description={firm.slug ? `Signs in as “${firm.slug}”.` : undefined} />
      </div>

      <Section title="Firm">
        <InfoGrid>
          <InfoItem label="Name">{firm.name}</InfoItem>
          <InfoItem label="Slug (login)" mono>
            {firm.slug || '—'}
          </InfoItem>
          <InfoItem label="Firm ID" mono>
            {firm.id}
          </InfoItem>
        </InfoGrid>
      </Section>

      <ApiKeyPanel firmId={firmId} canManage />

      <Section title="Sessions" description="Sign out the firm’s head admin and every employee right now, without disabling any login — for a lost device or a suspected compromise.">
        <Button variant="secondary" onClick={() => setConfirmRevoke(true)}>
          <Icons.LogOut className="h-4 w-4" />
          Sign everyone out
        </Button>
      </Section>

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={revokeSessions}
        title={`Sign everyone at ${firm.name} out?`}
        description="Every live dashboard session for this firm ends immediately. They can sign in again with their current passwords."
        confirmLabel="Sign everyone out"
      />
    </div>
  )
}
