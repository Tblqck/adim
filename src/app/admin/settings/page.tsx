'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, ConfirmDialog, EmptyState, Icons, useToast } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { InfoGrid, InfoItem, Notice, Section, TD, TH, TR } from '@/components/admin/kit'
import { useAdminSession } from '@/components/admin/session-context'
import { adminFetch, apiJson, messageOf, signOut } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils/cn'

/**
 * IPs the server stealth-banned after repeated failed sign-ins. The only way
 * to see or lift a ban short of the server's break-glass CLI; super-admin
 * only, and a live super-admin session is never blocked by a ban.
 */
function IpBans() {
  const { toast } = useToast()
  const [bans, setBans] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lifting, setLifting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await apiJson<{ items: Record<string, string> }>('/ip-bans', {}, 'Could not load IP bans')
      if (result.ok) setBans(result.data.items ?? {})
      else setError(result.detail)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function lift(ip: string) {
    try {
      const response = await adminFetch(`/ip-bans/${encodeURIComponent(ip)}`, { method: 'DELETE' })
      if (response.ok) toast(`Ban lifted for ${ip}`)
      else toast(`Could not lift the ban (${response.status})`, 'error')
      await load()
    } catch (err) {
      const message = messageOf(err)
      if (message) toast(message, 'error')
    } finally {
      setLifting(null)
    }
  }

  const entries = Object.entries(bans ?? {})

  return (
    <Section title="Blocked sign-in addresses" description="Addresses banned automatically after repeated failed sign-ins. A banned address sees the normal “incorrect password” reply, so it cannot tell it is blocked.">
      {error ? (
        <Notice tone="error">{error}</Notice>
      ) : bans && entries.length === 0 ? (
        <EmptyState icon={Icons.ShieldCheck} title="No addresses are blocked." description="Bans appear here when an address fails to sign in too many times." className="py-8 sm:py-10" />
      ) : (
        <div className="-mx-4 overflow-x-auto sm:-mx-5">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800">
                <th className={TH}>Address</th>
                <th className={TH}>Banned</th>
                <th className={cn(TH, 'text-right')}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([ip, since]) => (
                <tr key={ip} className={TR}>
                  <td className={cn(TD, 'font-mono text-[13px]')}>{ip}</td>
                  <td className={cn(TD, 'text-neutral-400')}>{fmtDate(since)}</td>
                  <td className={cn(TD, 'text-right')}>
                    <Button variant="secondary" size="sm" onClick={() => setLifting(ip)}>
                      Lift ban
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={lifting !== null}
        onClose={() => setLifting(null)}
        onConfirm={() => (lifting ? lift(lifting) : undefined)}
        title={`Lift the ban on ${lifting ?? ''}?`}
        description="Sign-ins from this address are accepted again straight away."
        confirmLabel="Lift ban"
        confirmVariant="primary"
      />
    </Section>
  )
}

export default function SettingsPage() {
  const { me, isSuperAdmin } = useAdminSession()

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Settings" description="Your account, and platform security for the back office." />

      <Section title="Account">
        <div className="space-y-4">
          <InfoGrid>
            <InfoItem label="Signed in as">{me.display_name || '—'}</InfoItem>
            <InfoItem label="Role">
              {isSuperAdmin ? 'Back office' : me.is_head_admin ? 'Firm head admin' : 'Employee'}
            </InfoItem>
            {!isSuperAdmin ? (
              <>
                <InfoItem label="Firm">{me.firm_name || '—'}</InfoItem>
                <InfoItem label="Firm ID (login)" mono>
                  {me.firm_slug || '—'}
                </InfoItem>
                <InfoItem label="Can manage users">{me.can_create_users ? 'Yes' : 'No'}</InfoItem>
              </>
            ) : null}
          </InfoGrid>
          <p className="text-xs leading-relaxed text-neutral-500">
            Passwords are set by whoever created the login — the back office for a firm, a firm admin for an employee. Ask them for a new one;
            there is no self-service change on the server yet.
          </p>
          <Button variant="secondary" onClick={() => void signOut()}>
            <Icons.LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </Section>

      {isSuperAdmin ? <IpBans /> : null}
    </div>
  )
}
