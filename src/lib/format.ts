import type { StatusTone } from '@/components/ui'

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString()
}

export function fmtPct(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

/** snake_case vocabulary from the API, as words. */
export function humanize(value: string | null | undefined): string {
  return (value ?? '').replace(/_/g, ' ')
}

/**
 * Verdict → status tone. "needs review" is checked before the pass/fail
 * split on purpose: it is neither a pass nor a confident fail (a low-quality
 * photo where an automated no_match is not trustworthy enough to act on), so
 * it must not render as a red rejection beside real failures.
 */
export function verdictTone(verified: boolean | null | undefined, verdict: string | null | undefined): StatusTone {
  const v = (verdict ?? '').toLowerCase()
  if (v.includes('review')) return 'warning'
  if (verified === true) return 'success'
  if (verified === false) return 'danger'
  if (v.includes('weak') || v.includes('warn')) return 'warning'
  if (/(^|_)(valid|strong_match|likely_match|clean|verified|pass)/.test(v)) return 'success'
  if (/(no_match|tampered|fail|reject|error)/.test(v)) return 'danger'
  return 'neutral'
}

export function verdictLabel(verified: boolean | null | undefined, verdict: string | null | undefined): string {
  return humanize(verdict || (verified ? 'verified' : 'pending'))
}

export function riskTone(classification: string | null | undefined): StatusTone {
  if (classification === 'CLEAN') return 'success'
  if (classification === 'POTENTIAL_MATCH') return 'warning'
  return 'muted'
}

export const DOC_TYPES = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID' },
  { value: 'drivers_license', label: "Driver's licence" },
  { value: 'residence_permit', label: 'Residence permit' },
] as const

export function docTypeLabel(value: string | null | undefined): string {
  return DOC_TYPES.find((d) => d.value === value)?.label ?? (humanize(value) || '—')
}

/**
 * Generated in the browser with the Web Crypto CSPRNG, as the old dashboard
 * did. The server does have /generate-password, but it adds a round trip for
 * nothing a browser cannot do as well.
 */
export function generateSecurePassword(length = 20): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+'
  const values = new Uint32Array(length)
  crypto.getRandomValues(values)
  return Array.from(values, (v) => charset[v % charset.length]).join('')
}
