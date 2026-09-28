'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Icons, type IconComponent } from '@/components/ui'
import { useAdminSession } from '@/components/admin/session-context'
import { messageOf } from '@/lib/api'
import { countryByCode, countryFlag } from '@/lib/countries'
import { loadRegistry, type Registry } from '@/lib/templates'

export const DOC_TYPE_ICON: Record<string, IconComponent> = {
  passport: Icons.Passport,
  national_id: Icons.CreditCard,
  drivers_license: Icons.Car,
  residence_permit: Icons.User,
}

export function countryName(code: string): string {
  return countryByCode(code)?.name ?? code
}

export function useRegistry() {
  const { isSuperAdmin, firmId } = useAdminSession()
  const firmQuery = isSuperAdmin && firmId ? `firm_id=${firmId}` : ''
  const [registry, setRegistry] = useState<Registry | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (force = false) => {
      setError(null)
      try {
        setRegistry(await loadRegistry(firmQuery, force))
      } catch (err) {
        setError(err instanceof Error && err.message !== 'not authenticated' ? err.message : messageOf(err))
      }
    },
    [firmQuery],
  )

  useEffect(() => {
    setRegistry(null)
    void load()
  }, [load])

  return { registry, error, reload: () => load(true) }
}

export function Breadcrumbs({ trail }: { trail: { label: string; href?: string; flag?: string }[] }) {
  return (
    <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-sm text-neutral-400" aria-label="Breadcrumb">
      {trail.map((crumb, index) => (
        <span key={crumb.label} className="flex items-center gap-1.5">
          {index > 0 ? <Icons.ChevronRight className="h-3.5 w-3.5 text-neutral-600" /> : null}
          {crumb.href ? (
            <Link href={crumb.href} className="transition-colors hover:text-neutral-200">
              {crumb.flag ? <span aria-hidden="true">{crumb.flag} </span> : null}
              {crumb.label}
            </Link>
          ) : (
            <span className="text-neutral-200">
              {crumb.flag ? <span aria-hidden="true">{crumb.flag} </span> : null}
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function ScanNotice({ registry }: { registry: Registry }) {
  if (registry.scanned >= registry.total) return null
  return (
    <p className="mb-6 text-xs text-neutral-500">
      Built from the newest {registry.scanned} of {registry.total} verifications.
    </p>
  )
}

export { countryFlag }
