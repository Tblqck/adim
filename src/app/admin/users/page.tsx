'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, CardHeader, EmptyState, Field, Icons, Input, StatusBadge, useToast } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { Notice, PasswordField, Section, TableSkeletonRows, TD, TH, TR, TR_CLICKABLE, TR_DELETED } from '@/components/admin/kit'
import { DeletePermanentlyButton } from '@/components/admin/recycle'
import { useAdminSession } from '@/components/admin/session-context'
import { adminFetch, apiJson, jsonBody, messageOf } from '@/lib/api'
import { fmtDay } from '@/lib/format'
import type { FirmUser } from '@/lib/types'
import { cn } from '@/lib/utils/cn'

/**
 * A firm's named employee logins. Firm-scoped on the server: a super-admin
 * has no single firm's employees (the server answers 400), and a login
 * without "create users" gets a 403.
 */
export default function UsersPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { me, isSuperAdmin, canManageUsers } = useAdminSession()
  const [users, setUsers] = useState<FirmUser[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [canCreate, setCanCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const result = await apiJson<{ items: FirmUser[] }>('/firm-users', {}, 'Could not load employees')
      if (result.ok) setUsers(result.data.items ?? [])
      else setListError(result.detail)
    } catch (err) {
      setListError(messageOf(err))
    }
  }, [])

  useEffect(() => {
    if (!isSuperAdmin && canManageUsers) void load()
  }, [isSuperAdmin, canManageUsers, load])

  if (isSuperAdmin) return <Notice tone="warning">Employee logins belong to a firm — sign in as that firm to manage them.</Notice>
  if (!canManageUsers) return <Notice tone="warning">Your login is not permitted to manage employee logins.</Notice>

  async function create() {
    setError(null)
    const cleanUsername = username.trim().toLowerCase()
    if (!cleanUsername || !displayName.trim() || !password) {
      setError('Username, display name and password are all required.')
      return
    }
    setCreating(true)
    try {
      const result = await apiJson(
        '/firm-users',
        { method: 'POST', ...jsonBody({ username: cleanUsername, display_name: displayName.trim(), password, can_create_users: canCreate }) },
        'Create failed',
      )
      if (!result.ok) {
        setError(result.detail)
        return
      }
      toast(`Login created for ${cleanUsername}`)
      setUsername('')
      setDisplayName('')
      setPassword('')
      setCanCreate(false)
      await load()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setCreating(false)
    }
  }

  async function toggle(user: FirmUser, field: 'can_create_users' | 'active') {
    try {
      const response = await adminFetch(`/firm-users/${user.id}`, { method: 'PATCH', ...jsonBody({ [field]: !user[field] }) })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { detail?: string }
        toast(body.detail || `Update failed (${response.status})`, 'error')
      }
      await load()
    } catch (err) {
      const message = messageOf(err)
      if (message) toast(message, 'error')
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Users" description="Named logins for your team. Their name is stamped on every review and screen they run." />

      {me.firm_name || me.firm_slug ? (
        <Notice>
          Employees sign in with <strong className="font-medium text-neutral-100">Firm ID: {me.firm_slug || me.firm_name}</strong>, their own
          username, and their password.
        </Notice>
      ) : null}

      <Section title="New employee">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username" htmlFor="u-username">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="jane" autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="Display name" htmlFor="u-display">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Smith" />
            </Field>
          </div>
          <Field label="Password" htmlFor="u-password">
            <PasswordField id="u-password" value={password} onChange={setPassword} placeholder="Choose or generate a password" />
          </Field>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-neutral-300">
            <input type="checkbox" checked={canCreate} onChange={(e) => setCanCreate(e.target.checked)} className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 accent-brand-500" />
            Can create and manage other logins
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button onClick={create} loading={creating}>
            <Icons.Plus className="h-4 w-4" />
            Create user
          </Button>
        </div>
      </Section>

      <Card>
        <CardHeader title="Employees" description={users ? `${users.filter((u) => !u.deleted_at).length} logins` : undefined} />
        {listError ? (
          <div className="p-4 sm:p-5">
            <Notice tone="error">{listError}</Notice>
          </div>
        ) : users && users.length === 0 ? (
          <EmptyState icon={Icons.Users} title="No employees yet." description="Create the first login above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className={TH}>User</th>
                  <th className={TH}>Can create users</th>
                  <th className={TH}>Status</th>
                  <th className={cn(TH, 'hidden md:table-cell')}>Created</th>
                  <th className={cn(TH, 'text-right')}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {!users ? (
                  <TableSkeletonRows cols={5} rows={4} />
                ) : (
                  users.map((user) => {
                    const deleted = !!user.deleted_at
                    return (
                      <tr key={user.id} className={cn(TR, TR_CLICKABLE, deleted && TR_DELETED)} onClick={() => router.push(`/admin/users/${user.id}`)}>
                        <td className={TD}>
                          <div className="font-medium text-white">{user.display_name}</div>
                          <div className="font-mono text-xs text-neutral-500">@{user.username}</div>
                        </td>
                        <td className={TD}>
                          <StatusBadge tone={user.can_create_users ? 'success' : 'muted'}>{user.can_create_users ? 'Yes' : 'No'}</StatusBadge>
                        </td>
                        <td className={TD}>
                          <StatusBadge tone={user.active ? 'success' : 'danger'}>{user.active ? 'Active' : 'Disabled'}</StatusBadge>
                        </td>
                        <td className={cn(TD, 'hidden text-neutral-400 md:table-cell')}>{fmtDay(user.created_at)}</td>
                        <td className={cn(TD, 'text-right')} onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button variant="ghost" size="sm" disabled={deleted} onClick={() => toggle(user, 'can_create_users')}>
                              {user.can_create_users ? 'Revoke create-users' : 'Allow create-users'}
                            </Button>
                            <Button variant="ghost" size="sm" disabled={deleted} onClick={() => toggle(user, 'active')}>
                              {user.active ? 'Disable' : 'Re-enable'}
                            </Button>
                            <DeletePermanentlyButton
                              path={`/firm-users/${user.id}`}
                              title={`Delete the login for ${user.username}?`}
                              description="The login stops working and the person is signed out straight away. Logins are deleted outright on the server — they do not go to the Recycle Bin and cannot be restored. To pause access instead, use Disable."
                              label="Delete"
                              onDone={load}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
