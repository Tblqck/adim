'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Button, ConfirmDialog, Icons, LoadingState, StatusBadge, useToast } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { InfoGrid, InfoItem, Notice, Section } from '@/components/admin/kit'
import { adminFetch, apiJson, jsonBody, messageOf } from '@/lib/api'
import { fmtDate } from '@/lib/format'
import type { FirmUser } from '@/lib/types'

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { toast } = useToast()
  const [user, setUser] = useState<FirmUser | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'signout' | null>(null)

  // Read from the list rather than GET /firm-users/{id}: the list exists on
  // every server version, the single-user route does not.
  const load = useCallback(async () => {
    try {
      const result = await apiJson<{ items: FirmUser[] }>('/firm-users', {}, 'Could not load employee')
      if (!result.ok) {
        setError(result.detail)
        return
      }
      const found = result.data.items.find((u) => String(u.id) === id)
      if (found) setUser(found)
      else setError('Employee not found.')
    } catch (err) {
      setError(messageOf(err))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function send(path: string, init: RequestInit, success: string, after?: () => void) {
    try {
      const response = await adminFetch(path, init)
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { detail?: string }
        toast(body.detail || `Failed (${response.status})`, 'error')
        return
      }
      toast(success)
      if (after) after()
      else await load()
    } catch (err) {
      const message = messageOf(err)
      if (message) toast(message, 'error')
    } finally {
      setConfirm(null)
    }
  }

  const back = (
    <Link href="/admin/users" className="mb-2 inline-flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200">
      <Icons.ChevronLeft className="h-4 w-4" />
      Users
    </Link>
  )

  if (error && !user) {
    return (
      <>
        {back}
        <Notice tone="error">{error}</Notice>
      </>
    )
  }
  if (!user) return <LoadingState title="Loading employee" />

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        {back}
        <PageHeader title={user.display_name} description={`@${user.username}`} />
      </div>

      <Section title="Employee">
        <InfoGrid>
          <InfoItem label="Username" mono>
            {user.username}
          </InfoItem>
          <InfoItem label="Display name">{user.display_name}</InfoItem>
          <InfoItem label="Can create users">
            <StatusBadge tone={user.can_create_users ? 'success' : 'muted'}>{user.can_create_users ? 'Yes' : 'No'}</StatusBadge>
          </InfoItem>
          <InfoItem label="Status">
            <StatusBadge tone={user.active ? 'success' : 'danger'}>{user.active ? 'Active' : 'Disabled'}</StatusBadge>
          </InfoItem>
          <InfoItem label="Created">{fmtDate(user.created_at)}</InfoItem>
        </InfoGrid>
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => send(`/firm-users/${user.id}`, { method: 'PATCH', ...jsonBody({ can_create_users: !user.can_create_users }) }, 'Permission updated')}>
            {user.can_create_users ? 'Revoke create-users' : 'Allow create-users'}
          </Button>
          <Button variant="secondary" onClick={() => send(`/firm-users/${user.id}`, { method: 'PATCH', ...jsonBody({ active: !user.active }) }, user.active ? 'Login disabled' : 'Login re-enabled')}>
            {user.active ? 'Disable' : 'Re-enable'}
          </Button>
          <Button variant="secondary" onClick={() => setConfirm('signout')}>
            <Icons.LogOut className="h-4 w-4" />
            Sign out everywhere
          </Button>
          <Button variant="danger" onClick={() => setConfirm('delete')}>
            <Icons.Trash className="h-4 w-4" />
            Delete login
          </Button>
        </div>
      </Section>

      <ConfirmDialog
        open={confirm === 'signout'}
        onClose={() => setConfirm(null)}
        onConfirm={() => send(`/firm-users/${user.id}/revoke-sessions`, { method: 'POST' }, `${user.username} was signed out`)}
        title={`Sign ${user.username} out everywhere?`}
        description="Their current sessions end immediately — for a shared or lost device. The login itself keeps working."
        confirmLabel="Sign out"
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => send(`/firm-users/${user.id}`, { method: 'DELETE' }, 'Login deleted', () => router.push('/admin/users'))}
        title={`Delete the login for ${user.username}?`}
        description="The login stops working and the person is signed out straight away. Logins are deleted outright on the server — they do not go to the Recycle Bin and cannot be restored. To pause access instead, use Disable."
        confirmLabel="Delete login"
      />
    </div>
  )
}
