'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, ConfirmDialog, StatusBadge } from '@/components/ui'
import { InfoGrid, InfoItem, Notice, OneTimeSecret, Section } from '@/components/admin/kit'
import { apiJson, messageOf } from '@/lib/api'

interface KeyStatus {
  firm_id: number
  firm_name: string
  firm_slug: string
  has_key: boolean
}

/**
 * A firm's server-to-server API key (X-Api-Key) — separate from the dashboard
 * password on purpose, so rotating one never signs anyone out of the other.
 * The key is shown exactly once, when minted; the server keeps only a hash.
 */
export function ApiKeyPanel({
  firmId,
  canManage,
  onSlug,
}: {
  /** Required for a super-admin; a firm session is scoped by the server. */
  firmId: number | null
  canManage: boolean
  onSlug?: (slug: string) => void
}) {
  const query = firmId ? `?firm_id=${firmId}` : ''
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const result = await apiJson<KeyStatus>(`/firm-api-key${query}`, {}, 'Could not load the key status')
      if (result.ok) {
        setStatus(result.data)
        onSlug?.(result.data.firm_slug)
      } else setError(result.detail)
    } catch (err) {
      setError(messageOf(err))
    }
  }, [query, onSlug])

  useEffect(() => {
    setStatus(null)
    setNewKey(null)
    void load()
  }, [load])

  async function rotate() {
    setError(null)
    try {
      const result = await apiJson<{ api_key: string }>(`/firm-api-key/rotate${query}`, { method: 'POST' }, 'Could not generate a key')
      if (!result.ok) {
        setError(result.detail)
        return
      }
      setNewKey(result.data.api_key)
      await load()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setConfirm(null)
    }
  }

  async function revoke() {
    setError(null)
    try {
      const result = await apiJson<{ ok: boolean }>(`/firm-api-key${query}`, { method: 'DELETE' }, 'Could not remove the key')
      if (!result.ok) {
        setError(result.detail)
        return
      }
      setNewKey(null)
      await load()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setConfirm(null)
    }
  }

  const hasKey = !!status?.has_key

  return (
    <Section
      title="API key"
      description="Used as the X-Api-Key header, with the firm slug as X-Client-Id, when the firm's own backend calls the verification API."
    >
      <div className="space-y-4">
        <InfoGrid>
          <InfoItem label="Status">
            {status ? <StatusBadge tone={hasKey ? 'success' : 'muted'}>{hasKey ? 'Active' : 'Not set'}</StatusBadge> : '…'}
          </InfoItem>
          {status ? (
            <InfoItem label="Firm" mono>
              {status.firm_slug}
            </InfoItem>
          ) : null}
        </InfoGrid>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {newKey ? (
          <OneTimeSecret label="New API key" value={newKey} note="Shown only this once — save it now. Any previous key stopped working when this one was generated." />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => (hasKey ? setConfirm('rotate') : void rotate())} disabled={!canManage || !status}>
            {hasKey ? 'Rotate key' : 'Generate key'}
          </Button>
          <Button variant="secondary" onClick={() => setConfirm('revoke')} disabled={!canManage || !hasKey}>
            Remove key
          </Button>
        </div>
        {!canManage ? <p className="text-xs text-neutral-500">Ask your firm admin to manage the API key.</p> : null}
        <p className="text-xs leading-relaxed text-neutral-500">
          Keys and passwords are shown once, when created or rotated — the server never stores a form it could hand back. Rotating issues a new
          key and invalidates the old one immediately.
        </p>
      </div>
      <ConfirmDialog
        open={confirm === 'rotate'}
        onClose={() => setConfirm(null)}
        onConfirm={rotate}
        title="Rotate the API key?"
        description="The current key stops working immediately. Anything still using it will fail until it is given the new one."
        confirmLabel="Rotate key"
      />
      <ConfirmDialog
        open={confirm === 'revoke'}
        onClose={() => setConfirm(null)}
        onConfirm={revoke}
        title="Remove the API key?"
        description="Server-to-server access stops immediately until a new key is generated. The dashboard login is not affected."
        confirmLabel="Remove key"
      />
    </Section>
  )
}
