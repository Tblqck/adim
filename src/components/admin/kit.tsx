'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button, Card, CardBody, CardHeader, Icons, Input } from '@/components/ui'
import { cn } from '@/lib/utils/cn'
import { countryFlag, searchCountries, type Country } from '@/lib/countries'
import { generateSecurePassword } from '@/lib/format'

/*
 * Small admin-side building blocks shared by several pages. Everything here
 * composes the white-label UI kit (src/components/ui); nothing invents a new
 * visual language.
 */

// ── Banners ──────────────────────────────────────────────────────────────

const NOTICE_TONE = {
  error: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  info: 'border-neutral-700 bg-neutral-900 text-neutral-300',
  success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
} as const

export function Notice({
  tone = 'info',
  children,
  className,
}: {
  tone?: keyof typeof NOTICE_TONE
  children: ReactNode
  className?: string
}) {
  const Icon = tone === 'error' ? Icons.Alert : tone === 'warning' ? Icons.AlertTriangle : tone === 'success' ? Icons.CheckCircle : Icons.Info
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn('flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm leading-relaxed', NOTICE_TONE[tone], className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

// ── Label / value grid ───────────────────────────────────────────────────

export function InfoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}>{children}</dl>
}

export function InfoItem({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-neutral-800 bg-neutral-950/60 px-4 py-3">
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className={cn('mt-1 break-words text-sm text-neutral-100', mono && 'font-mono text-[13px]')}>{children}</dd>
    </div>
  )
}

/** A card section: the white-label Card with a header. */
export function Section({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} action={action} />
      <CardBody className={bodyClassName}>{children}</CardBody>
    </Card>
  )
}

// ── Tabs ─────────────────────────────────────────────────────────────────

export interface TabItem<K extends string> {
  key: K
  label: ReactNode
}

/** The white-label review page's underline tab strip. */
export function TabStrip<K extends string>({
  tabs,
  active,
  onSelect,
  className,
  label,
}: {
  tabs: readonly TabItem<K>[]
  active: K
  onSelect: (key: K) => void
  className?: string
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('no-scrollbar flex items-center gap-6 overflow-x-auto', className)}>
      {tabs.map((tab) => {
        const selected = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.key)}
            className={cn(
              'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-t-sm border-b-2 pb-3 pt-1 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              selected
                ? 'border-brand-500 font-medium text-white'
                : 'border-transparent text-neutral-400 hover:border-neutral-700 hover:text-neutral-200',
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Tables ───────────────────────────────────────────────────────────────

export const TH = 'whitespace-nowrap px-4 py-3 text-xs font-medium text-neutral-500 sm:px-5'
export const TD = 'px-4 py-3.5 align-middle text-neutral-200 sm:px-5'
export const TR = 'border-b border-neutral-800/70 last:border-0'
export const TR_CLICKABLE = 'cursor-pointer transition-colors hover:bg-neutral-800/40'
/** Soft-deleted rows: still listed (so they can be restored), visibly faded. */
export const TR_DELETED = 'opacity-50'

export function TableSkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className={TR}>
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className={TD}>
              <span className="block h-4 w-3/4 animate-pulse rounded bg-neutral-800/70" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ── Copy ─────────────────────────────────────────────────────────────────

export function CopyButton({ value, label = 'Copy', size = 'sm' }: { value: string; label?: string; size?: 'sm' | 'md' }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), 1500)
    return () => clearTimeout(timer)
  }, [state])
  return (
    <Button
      variant="secondary"
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setState('copied')
        } catch {
          setState('failed')
        }
      }}
    >
      {state === 'copied' ? <Icons.Check className="h-4 w-4" /> : <Icons.Copy className="h-4 w-4" />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed — select it' : label}
    </Button>
  )
}

/**
 * A secret the server returns exactly once (a password it just set, an API
 * key it just minted). It is never retrievable again, so it says so.
 */
export function OneTimeSecret({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
      <div>
        <p className="text-xs font-medium text-neutral-400">{label}</p>
        <p className="mt-1 break-all font-mono text-sm text-white">{value}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton value={value} />
        <p className="text-xs text-rose-300">{note ?? 'Shown only this once — save it now. It cannot be retrieved again.'}</p>
      </div>
    </div>
  )
}

// ── Password (set for someone else) ──────────────────────────────────────

/**
 * For "set a password for someone else" forms: the value has to be read off
 * the screen and relayed to that person, so unlike a sign-in field it can be
 * shown, copied and generated.
 */
export function PasswordField({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
        className="font-mono"
      />
      <div className="flex shrink-0 gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            onChange(generateSecurePassword())
            setVisible(true)
          }}
        >
          Generate
        </Button>
        <Button variant="secondary" onClick={() => setVisible((v) => !v)}>
          {visible ? 'Hide' : 'Show'}
        </Button>
        <CopyButton value={value} size="md" />
      </div>
    </div>
  )
}

// ── Country picker ───────────────────────────────────────────────────────

/**
 * Searchable country picker. The value is always an ISO alpha-2 code or ''
 * — the API rejects anything else, so half-typed text never leaves here.
 */
export function CountryInput({
  id,
  value,
  onChange,
  placeholder = 'Search countries…',
}: {
  id?: string
  value: string
  onChange: (code2: string) => void
  placeholder?: string
}) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-list`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selected = value ? searchCountries(value, 250).find((c) => c.code2 === value.toUpperCase()) : undefined
  const results = searchCountries(query)
  const shown = open ? query : selected ? `${countryFlag(selected.code2)} ${selected.name}` : query

  function choose(country: Country | null) {
    onChange(country ? country.code2 : '')
    setQuery('')
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className="relative">
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={shown}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 150)
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          setActive(-1)
          if (!event.target.value) onChange('')
        }}
        onKeyDown={(event) => {
          if (!open) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((i) => Math.min(results.length - 1, i + 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((i) => Math.max(0, i - 1))
          } else if (event.key === 'Enter') {
            const pick = results[active] ?? (results.length === 1 ? results[0] : undefined)
            if (pick) {
              event.preventDefault()
              choose(pick)
            }
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {value && !open ? (
        <button
          type="button"
          aria-label="Clear country"
          onClick={() => choose(null)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-500 hover:text-neutral-200"
        >
          <Icons.Close className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-neutral-800 bg-surface py-1 shadow-2xl shadow-black/50"
          onMouseDown={(event) => {
            // Keep focus in the input so blur does not close the list first.
            event.preventDefault()
            if (blurTimer.current) clearTimeout(blurTimer.current)
          }}
        >
          {results.length ? (
            results.map((country, index) => (
              <li
                key={country.code2}
                role="option"
                aria-selected={index === active}
                onClick={() => choose(country)}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-neutral-200',
                  index === active ? 'bg-brand-500/15' : 'hover:bg-neutral-800/70',
                )}
              >
                <span aria-hidden="true">{countryFlag(country.code2)}</span>
                <span className="flex-1 truncate">{country.name}</span>
                <span className="text-xs text-neutral-500">{country.code2}</span>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-neutral-500">No matches</li>
          )}
        </ul>
      ) : null}
    </div>
  )
}
