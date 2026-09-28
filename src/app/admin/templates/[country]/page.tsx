'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Notice } from '@/components/admin/kit'
import { Skeleton, StatusBadge } from '@/components/ui'
import { docTypeLabel, fmtDay } from '@/lib/format'
import { DOCUMENT_TYPES, isGap } from '@/lib/templates'
import { cn } from '@/lib/utils/cn'
import { Breadcrumbs, countryFlag, countryName, DOC_TYPE_ICON, ScanNotice, useRegistry } from '@/app/admin/templates/shared'

/** One country: its four document types, received or not yet. */
export default function CountryTemplatesPage() {
  const { country: raw } = useParams<{ country: string }>()
  const country = raw.toUpperCase()
  const { registry, error } = useRegistry()
  const designs = registry?.designs.filter((d) => d.country === country) ?? []
  // Every standard type is shown; ones not received yet stay visible (muted)
  // so the page says what is missing, not only what exists.
  const types = [...new Set([...DOCUMENT_TYPES, ...designs.map((d) => d.docType)])]

  return (
    <div className="animate-fade-in">
      <Breadcrumbs trail={[{ label: 'All countries', href: '/admin/templates' }, { label: countryName(country), flag: countryFlag(country) }]} />
      <div className="mb-7">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
          <span aria-hidden="true">{countryFlag(country)}</span>
          {countryName(country)}
        </h1>
        <p className="mt-1.5 text-sm text-neutral-400">The document types received from {countryName(country)}.</p>
      </div>

      {error ? <Notice tone="error" className="mb-6">{error}</Notice> : null}
      {registry ? <ScanNotice registry={registry} /> : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {types.map((type) => {
          const design = designs.find((d) => d.docType === type)
          const Icon = DOC_TYPE_ICON[type] ?? DOC_TYPE_ICON.national_id!
          if (!registry) return <Skeleton key={type} className="h-40 rounded-2xl" />
          const card = (
            <>
              <div
                className={cn(
                  'mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 transition-colors',
                  design && 'group-hover:border-brand-500/40',
                )}
              >
                <Icon className={cn('h-5 w-5', design ? 'text-neutral-400 group-hover:text-brand-400' : 'text-neutral-600')} />
              </div>
              <p className={cn('font-medium', design ? 'text-neutral-100 group-hover:text-brand-300' : 'text-neutral-500')}>{docTypeLabel(type)}</p>
              {design ? (
                <>
                  <p className="mt-1 text-xs text-neutral-500">
                    {design.received} received · last {fmtDay(design.lastSeen)}
                  </p>
                  {isGap(design) ? (
                    <StatusBadge tone="warning" className="mt-2.5">
                      No reference design
                    </StatusBadge>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-xs text-neutral-600">None received yet</p>
              )}
            </>
          )
          return design ? (
            <Link
              key={type}
              href={`/admin/templates/${country}/${type}`}
              className="group rounded-2xl border border-neutral-800 bg-surface p-5 text-center transition-colors hover:border-brand-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {card}
            </Link>
          ) : (
            <div key={type} className="rounded-2xl border border-dashed border-neutral-800 p-5 text-center">
              {card}
            </div>
          )
        })}
      </div>
    </div>
  )
}
