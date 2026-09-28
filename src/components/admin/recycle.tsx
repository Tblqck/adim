'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button, ConfirmDialog, Icons, useToast } from '@/components/ui'
import { adminFetch, messageOf } from '@/lib/api'

/*
 * The Recycle Bin is where deleting happens.
 *
 * Deleting a verification or a link anywhere in the dashboard moves it to the
 * bin; it is only removed for good from the bin — by the back office there, or
 * by the server's retention sweep once RETENTION_HOURS have passed. Restoring
 * also happens there.
 *
 * What the live server can do, which is why not everything goes to the bin:
 *   verification, firm login  soft delete (deleted_at) + restore, purged after RETENTION_HOURS
 *   verification, back office only an immediate permanent delete (?confirm=true)
 *   generated link            soft delete + restore, purged after RETENTION_HOURS
 *   employee login, firm      immediate permanent delete, no restore
 */

/** The server's retention window (admin.py RETENTION_HOURS). */
export const RETENTION_HOURS = 42

/** When the server's sweep removes a binned item for good. */
export function purgeAt(deletedAt: string | null | undefined): Date | null {
  if (!deletedAt) return null
  const at = new Date(deletedAt)
  return Number.isNaN(at.getTime()) ? null : new Date(at.getTime() + RETENTION_HOURS * 3_600_000)
}

/** "in 17 h", "in 40 min", or "any moment now" once the window has passed. */
export function timeUntilPurge(deletedAt: string | null | undefined): string {
  const at = purgeAt(deletedAt)
  if (!at) return '—'
  const ms = at.getTime() - Date.now()
  if (ms <= 0) return 'any moment now'
  const minutes = Math.round(ms / 60_000)
  return minutes >= 60 ? `in ${Math.round(minutes / 60)} h` : `in ${Math.max(1, minutes)} min`
}

async function send(path: string, method: 'DELETE' | 'POST'): Promise<string | null> {
  try {
    const response = await adminFetch(path, { method })
    if (response.ok) return null
    const body = (await response.json().catch(() => ({}))) as { detail?: string }
    return body.detail || `Failed (${response.status})`
  } catch (error) {
    return messageOf(error) ?? ''
  }
}

function BinToast() {
  return (
    <>
      Moved to the{' '}
      <Link href="/admin/recycle-bin" className="underline underline-offset-2">
        Recycle Bin
      </Link>
    </>
  )
}

/** Soft delete: the item leaves the list and waits in the bin. */
export function MoveToBinButton({
  path,
  what,
  onDone,
  size = 'sm',
}: {
  /** The DELETE path; the server soft-deletes it. */
  path: string
  /** "this verification", "this link" — for the dialog. */
  what: string
  onDone: () => void
  size?: 'sm' | 'md'
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  return (
    <span onClick={(event) => event.stopPropagation()}>
      <Button variant={size === 'sm' ? 'ghost' : 'secondary'} size={size} onClick={() => setOpen(true)} className={size === 'sm' ? 'whitespace-nowrap text-neutral-400 hover:text-rose-300' : 'whitespace-nowrap'}>
        <Icons.Trash className="h-4 w-4" />
        Move to bin
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Move ${what} to the Recycle Bin?`}
        description={`It can be restored from the Recycle Bin for ${RETENTION_HOURS} hours. After that it is deleted permanently, with its images.`}
        confirmLabel="Move to bin"
        onConfirm={async () => {
          const error = await send(path, 'DELETE')
          setOpen(false)
          if (error === null) {
            toast(<BinToast />)
            onDone()
          } else if (error) toast(error, 'error')
        }}
      />
    </span>
  )
}

/** Permanent delete — for what the server cannot bin, and for emptying the bin. */
export function DeletePermanentlyButton({
  path,
  title,
  description,
  onDone,
  size = 'sm',
  label = 'Delete permanently',
}: {
  path: string
  title: string
  description: string
  onDone: () => void
  size?: 'sm' | 'md'
  label?: string
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  return (
    <span onClick={(event) => event.stopPropagation()}>
      <Button variant={size === 'sm' ? 'ghost' : 'danger'} size={size} onClick={() => setOpen(true)} className={size === 'sm' ? 'text-rose-400 hover:bg-rose-500/10 hover:text-rose-300' : undefined}>
        <Icons.Trash className="h-4 w-4" />
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          const error = await send(path, 'DELETE')
          setOpen(false)
          if (error === null) {
            toast('Deleted permanently')
            onDone()
          } else if (error) toast(error, 'error')
        }}
      />
    </span>
  )
}

export function RestoreButton({ path, onDone, size = 'sm' }: { path: string; onDone: () => void; size?: 'sm' | 'md' }) {
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  return (
    <Button
      variant="secondary"
      size={size}
      loading={pending}
      onClick={async (event) => {
        event.stopPropagation()
        setPending(true)
        const error = await send(path, 'POST')
        setPending(false)
        if (error === null) {
          toast('Restored')
          onDone()
        } else if (error) toast(error, 'error')
      }}
    >
      <Icons.Refresh className="h-4 w-4" />
      Restore
    </Button>
  )
}
