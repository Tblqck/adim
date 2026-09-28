'use client'

import { useId, useRef, useState } from 'react'
import { Icons, Input } from '@/components/ui'
import { useAdminSession } from '@/components/admin/session-context'
import type { Firm } from '@/lib/types'
import { cn } from '@/lib/utils/cn'

/**
 * Pick one firm by typing part of its name, slug or ID — for the back
 * office, which acts on every firm. Firm logins never see this: the server
 * scopes them to their own firm from the session.
 */
export function FirmSearch({
  id,
  value,
  onChange,
  placeholder = 'Search firms by name, slug or ID…',
}: {
  id?: string
  value: number | null
  onChange: (firmId: number | null) => void
  placeholder?: string
}) {
  const { firms } = useAdminSession()
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-list`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const live = firms.filter((f) => !f.deleted_at)
  const selected = live.find((f) => f.id === value) ?? null
  const q = query.trim().toLowerCase()
  const results = (
    q
      ? live.filter((f) => f.name.toLowerCase().includes(q) || (f.slug ?? '').toLowerCase().includes(q) || String(f.id) === q)
      : live
  ).slice(0, 50)
  const shown = open ? query : selected ? `${selected.name}${selected.slug ? ` (${selected.slug})` : ''}` : query

  function choose(firm: Firm | null) {
    onChange(firm ? firm.id : null)
    setQuery('')
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className="relative">
      <Icons.Building className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={shown}
        placeholder={placeholder}
        className="pl-9 pr-9"
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
      {selected && !open ? (
        <button
          type="button"
          aria-label="Clear firm"
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
            event.preventDefault()
            if (blurTimer.current) clearTimeout(blurTimer.current)
          }}
        >
          {results.length ? (
            results.map((firm, index) => (
              <li
                key={firm.id}
                role="option"
                aria-selected={index === active}
                onClick={() => choose(firm)}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-neutral-200',
                  index === active ? 'bg-brand-500/15' : 'hover:bg-neutral-800/70',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{firm.name}</span>
                <span className="font-mono text-xs text-neutral-500">{firm.slug}</span>
                <span className="text-xs tabular-nums text-neutral-600">#{firm.id}</span>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-neutral-500">{live.length ? 'No firm matches' : 'No firms loaded'}</li>
          )}
        </ul>
      ) : null}
    </div>
  )
}
