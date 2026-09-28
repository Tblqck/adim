'use client'

import { useEffect, useState } from 'react'
import { Card, EmptyState, Icons, Input, Skeleton } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { Notice, TabStrip } from '@/components/admin/kit'
import { DatabaseCard } from '@/components/admin/screening'
import { apiJson, messageOf } from '@/lib/api'
import type { DatabasesCatalog } from '@/lib/types'

const TABS = [
  { key: 'pep', name: 'Politically Exposed Persons (PEP)' },
  { key: 'sanctions', name: 'Global Sanctions' },
  { key: 'adverse_media', name: 'Adverse Media' },
] as const
type TabKey = (typeof TABS)[number]['key']

/**
 * The screening sources, read from the live server's catalog
 * (production/core/db_catalog.py via /databases-catalog) — the same list
 * every screen reports under "Databases checked", so the two stay in sync by
 * construction. The server maintains the lists; nothing here edits them.
 */
export default function AmlSettingsPage() {
  const [catalog, setCatalog] = useState<DatabasesCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('pep')
  const [query, setQuery] = useState('')

  useEffect(() => {
    apiJson<DatabasesCatalog>('/databases-catalog', {}, 'Could not load the database catalog')
      .then((result) => (result.ok ? setCatalog(result.data) : setError(result.detail)))
      .catch((err: unknown) => setError(messageOf(err)))
  }, [])

  const q = query.trim().toLowerCase()
  const items = (catalog?.[tab] ?? []).filter((d) => !q || d.name.toLowerCase().includes(q) || d.agency.toLowerCase().includes(q))
  const tabName = TABS.find((t) => t.key === tab)?.name ?? ''

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="AML settings"
        description="The PEP, sanctions and adverse-media sources every screen runs against. They are maintained on the verification server."
      />
      {error ? <Notice tone="error">{error}</Notice> : null}

      <TabStrip
        label="Source categories"
        className="border-b border-neutral-800"
        active={tab}
        onSelect={(next) => {
          setTab(next)
          setQuery('')
        }}
        tabs={TABS.map((t) => ({
          key: t.key,
          label: (
            <>
              {t.name}
              <span className="rounded-full bg-neutral-800 px-1.5 py-px text-[11px] text-neutral-400">{catalog ? catalog[t.key].length : '…'}</span>
            </>
          ),
        }))}
      />

      <div className="relative max-w-md">
        <Icons.Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tabName.toLowerCase()} sources…`} className="pl-9" />
      </div>

      {!catalog && !error ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((db) => (
            <DatabaseCard key={db.name} db={db} />
          ))}
        </div>
      ) : catalog ? (
        <Card>
          <EmptyState icon={Icons.Database} title="No sources match." description={q ? `Nothing in ${tabName} matches “${query}”.` : 'This category has no sources.'} />
        </Card>
      ) : null}
    </div>
  )
}
