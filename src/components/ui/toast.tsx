'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils/cn'
import { Icons } from '@/components/ui/icons'

/**
 * Toast notifications.
 *
 * Small hand-rolled provider rather than a dependency: the product needs one
 * success tone and one error tone, and the surface treatment has to match the
 * rest of the app.
 *
 * The region is `aria-live="polite"` so screen readers announce results
 * without stealing focus mid-task.
 */

export type ToastTone = 'success' | 'error' | 'info'

interface Toast {
  id: number
  tone: ToastTone
  message: ReactNode
}

interface ToastContextValue {
  toast: (message: ReactNode, tone?: ToastTone) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DISMISS_AFTER_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const toast = useCallback(
    (message: ReactNode, tone: ToastTone = 'success') => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, tone, message }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_AFTER_MS),
      )
    },
    [dismiss],
  )

  // Clear pending timers if the provider unmounts mid-countdown.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-4 sm:inset-x-auto sm:right-6 sm:items-end sm:pb-6"
      >
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const TONE_STYLE: Record<ToastTone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  error: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  info: 'border-neutral-700 bg-surface text-neutral-200',
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = toast.tone === 'error' ? Icons.Alert : toast.tone === 'success' ? Icons.Check : Icons.Inbox

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-lg shadow-black/40 backdrop-blur-md animate-fade-in-up',
        TONE_STYLE[toast.tone],
      )}
    >
      <Icon className="mt-px h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 text-sm leading-relaxed">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
      >
        <Icons.Close className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used inside a <ToastProvider>.')
  }
  return context
}
