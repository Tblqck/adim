'use client'

import { useState, type ReactNode } from 'react'
import { Button, type ButtonVariant } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

/**
 * Confirmation dialog for an action that cannot be undone.
 *
 * Owns the pending state so the confirm button disables itself for the
 * duration of `onConfirm` — the operator cannot double-fire a destructive
 * action by clicking twice.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  confirmVariant = 'danger',
  confirmDisabled = false,
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  confirmVariant?: ButtonVariant
  /**
   * Hold the confirm button until the dialog's own requirements are met — a
   * required reason, say. Distinct from `pending`, which is about the action
   * being in flight.
   */
  confirmDisabled?: boolean
  children?: ReactNode
}) {
  const [pending, setPending] = useState(false)

  const handleConfirm = async () => {
    if (pending) return
    setPending(true)
    try {
      await onConfirm()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={pending ? () => undefined : onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            loading={pending}
            disabled={confirmDisabled || pending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}
