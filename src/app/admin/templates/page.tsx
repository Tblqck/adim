'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button, Card, EmptyState, Icons, Skeleton, StatusBadge } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { Notice, TabStrip, TD, TH, TR, TR_CLICKABLE } from '@/components/admin/kit'
import { docTypeLabel, fmtDay } from '@/lib/format'
import { byCountry, isGap } from '@/lib/templates'
import { cn } from '@/lib/utils/cn'
import { countryFlag, countryName, ScanNotice, useRegistry } from '@/app/admin/templates/shared'
import { ReviewQueue } from '@/components/admin/template-cards'

function TemplatesIndex() {
  const router = useRouter()
  const pathname = usePathname()
  const view = useSearchParams().get('view') === 'list' ? 'list' : 'countries'
  const { registry, error, reload } = useRegistry()
  const countries = registry ? byCountry(registry.designs) : []
  const gaps = registry ? registry.designs.filter(isGap).length : 0

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Templates"
        description="The document designs this platform has received, built automatically from every verification — a new country or document type appears here the first time one arrives."
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            <Icons.Refresh className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {error ? <Notice tone="error" className="mb-6">{error}</Notice> : null}

      {registry ? (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {[
            ['Countries', countries.length, ''],
            ['Document designs', registry.designs.length, ''],
            ['Documents received', registry.received, ''],
            ['Without a reference design', gaps, gaps ? 'text-amber-400' : ''],
          ].map(([label, value, accent]) => (
            <Card key={label as string} className="px-4 py-4">
              <p className="text-xs font-medium text-neutral-400">{label}</p>
              <p className={cn('mt-1 text-2xl font-semibold tabular-nums tracking-tight text-white', accent as string)}>{value}</p>
            </Card>
          ))}
        </div>
      ) : null}

      <div className="mb-6">
        <ReviewQueue />
      </div>

      <TabStrip
        label="View"
        className="mb-6 border-b border-neutral-800"
        active={view}
        onSelect={(next) => router.replace(next === 'list' ? `${pathname}?view=list` : pathname)}
        tabs={[
          { key: 'countries', label: 'By country' },
          { key: 'list', label: 'All designs' },
        ]}
      />

      {registry ? <ScanNotice registry={registry} /> : null}

      {!registry && !error ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : registry && registry.designs.length === 0 ? (
        <Card>
          <EmptyState
            icon={Icons.CreditCard}
            title="No documents received yet."
            description="The first verification that comes in adds its country and document type here."
          />
        </Card>
      ) : view === 'countries' ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {countries.map((country) => (
            <Link
              key={country.country}
              href={`/admin/templates/${country.country}`}
              className="group relative rounded-2xl border border-neutral-800 bg-surface p-5 text-center transition-colors hover:border-brand-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {country.gaps ? (
                <span
                  className="absolute right-3 top-3 h-2 w-2 rounded-full bg-amber-400"
                  title={`${country.gaps} design${country.gaps === 1 ? '' : 's'} without a reference design`}
                />
              ) : null}
              <div className="mb-2 text-3xl" aria-hidden="true">
                {countryFlag(country.country)}
              </div>
              <p className="font-medium text-neutral-100 group-hover:text-brand-300">{countryName(country.country)}</p>
              <p className="mt-1 text-xs text-neutral-500">
                {country.designs.length} document design{country.designs.length === 1 ? '' : 's'} · {country.received} received
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800">
                  <th className={TH}>Design</th>
                  <th className={cn(TH, 'text-right')}>Received</th>
                  <th className={cn(TH, 'hidden md:table-cell')}>Last received</th>
                  <th className={TH}>Reference design</th>
                </tr>
              </thead>
              <tbody>
                {registry?.designs.map((design) => (
                  <tr
                    key={`${design.country}/${design.docType}`}
                    className={cn(TR, TR_CLICKABLE)}
                    onClick={() => router.push(`/admin/templates/${design.country}/${design.docType}`)}
                  >
                    <td className={TD}>
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden="true">{countryFlag(design.country)}</span>
                        <span className="font-medium text-white">{countryName(design.country)}</span>
                        <span className="text-neutral-400">{docTypeLabel(design.docType)}</span>
                      </span>
                    </td>
                    <td className={cn(TD, 'text-right tabular-nums')}>{design.received}</td>
                    <td className={cn(TD, 'hidden text-neutral-400 md:table-cell')}>{fmtDay(design.lastSeen)}</td>
                    <td className={TD}>
                      {isGap(design) ? (
                        <StatusBadge tone="warning">Not on file</StatusBadge>
                      ) : design.unidentified ? (
                        <StatusBadge tone="warning">
                          Missing for {design.unidentified} of {design.received}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="success">On file</StatusBadge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

export default function TemplatesPage() {
  return (
    <Suspense>
      <TemplatesIndex />
    </Suspense>
  )
}
