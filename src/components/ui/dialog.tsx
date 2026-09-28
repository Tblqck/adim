'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils/cn'
import { Icons } from '@/components/ui/icons'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Modal dialog.
 *
 * Handcrafted rather than pulled from a component library so the motion and
 * surface treatment match the rest of the app. Handles the accessibility
 * essentials: focus trap, restore focus on close, Escape to dismiss, and
 * scroll lock behind the overlay.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  useEffect(() => {
    if (!open) return

    previouslyFocused.current = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)

    // Move focus into the dialog on the next frame, once it is mounted.
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current
      const target = panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel
      target?.focus()
    })

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = overflow
      previouslyFocused.current?.focus()
    }
  }, [open, handleKeyDown])

  if (!open || !mounted) return null

  // Rendered on the body, deliberately. An ancestor carrying
  // `backdrop-filter` — the review page's sticky header, for one — becomes
  // the containing block for `position: fixed`, and a dialog inside it
  // centres itself inside that strip instead of the window.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/75 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby={description ? 'dialog-description' : undefined}
        tabIndex={-1}
        className={cn(
          'w-full overflow-hidden border border-neutral-800 bg-surface shadow-2xl outline-none animate-zoom-in',
          // Full-width sheet on phones, centred card from `sm` up.
          'rounded-t-2xl sm:rounded-2xl',
          size === 'sm' ? 'sm:max-w-sm' : 'sm:max-w-md',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-neutral-800 px-5 py-4">
          <div className="min-w-0">
            <h2 id="dialog-title" className="text-base font-semibold text-white">
              {title}
            </h2>
            {description ? (
              <p id="dialog-description" className="mt-1 text-sm text-neutral-400">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1.5 -mt-1 rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <Icons.Close className="h-4 w-4" />
          </button>
        </div>

        {children ? <div className="px-5 py-5">{children}</div> : null}

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-neutral-800 bg-neutral-950/40 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
