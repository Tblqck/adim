'use client'

import { apiJson } from '@/lib/api'
import { fieldValue, mrzReading } from '@/lib/checks'
import type { Paged, VerificationDetail, VerificationRow } from '@/lib/types'

/*
 * The document-design registry, built from the documents that arrive.
 *
 * The white-label platform keeps a hand-maintained template registry in its
 * own database. The live server has none — but every verification already
 * records its country and document type, and its detail records how that
 * document read: which MRZ format and side, which fields came out, whether a
 * reference design was on file to compare against. Grouping verifications by
 * (country, document type) turns that history into a registry that fills
 * itself: the first document of a new design adds it here, every later one
 * updates what is known about it. Nothing to seed, nothing to keep in sync.
 */

export const DOCUMENT_TYPES = ['passport', 'national_id', 'drivers_license', 'residence_permit'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

// The list endpoint has no grouping, so the registry is read from the newest
// SCAN_ROWS verifications. The pages say so when history is longer.
const SCAN_ROWS = 2000
const CACHE_MS = 60_000

export interface Design {
  country: string
  docType: string
  received: number
  firstSeen: string
  lastSeen: string
  passed: number
  flagged: number
  /**
   * Received documents the pipeline could not compare with a reference design
   * (combined verdict mrz_face_pass: no reference image on file). A design
   * where this is every document is a gap — known to the platform only by
   * what the applicant said it was.
   */
  unidentified: number
  modes: Record<string, number>
  rows: VerificationRow[]
}

export interface Registry {
  designs: Design[]
  /** Rows read from the list (binned ones included). */
  scanned: number
  /** Documents that make up the registry (binned ones left out). */
  received: number
  total: number
  loadedAt: number
}

let cached: { key: string; registry: Registry } | null = null

export async function loadRegistry(firmQuery: string, force = false): Promise<Registry> {
  if (!force && cached && cached.key === firmQuery && Date.now() - cached.registry.loadedAt < CACHE_MS) return cached.registry

  const rows: VerificationRow[] = []
  let total = 0
  let read = 0
  for (let page = 1; page <= SCAN_ROWS / 100; page++) {
    const result = await apiJson<Paged<VerificationRow>>(
      `/verifications?page=${page}&page_size=100${firmQuery ? `&${firmQuery}` : ''}`,
      {},
      'Could not load verifications',
    )
    if (!result.ok) throw new Error(result.detail)
    total = result.data.total
    read += result.data.items.length
    // Binned rows are on their way out; they do not describe a design.
    rows.push(...result.data.items.filter((row) => !row.deleted_at))
    if (page * 100 >= total || result.data.items.length === 0) break
  }

  const byKey = new Map<string, Design>()
  for (const row of rows) {
    if (!row.country || !row.doc_type) continue
    const country = row.country.toUpperCase()
    const key = `${country}/${row.doc_type}`
    const created = row.created_at ?? ''
    let design = byKey.get(key)
    if (!design) {
      design = { country, docType: row.doc_type, received: 0, firstSeen: created, lastSeen: created, passed: 0, flagged: 0, unidentified: 0, modes: {}, rows: [] }
      byKey.set(key, design)
    }
    design.received++
    if (created && created < design.firstSeen) design.firstSeen = created
    if (created > design.lastSeen) design.lastSeen = created
    if (row.verified === true) design.passed++
    else if (row.verified === false) design.flagged++
    if ((row.overall_verdict ?? '') === 'mrz_face_pass') design.unidentified++
    const mode = String(row.verification_mode ?? '')
    if (mode) design.modes[mode] = (design.modes[mode] ?? 0) + 1
    design.rows.push(row)
  }

  const registry: Registry = {
    designs: [...byKey.values()].sort((a, b) => b.received - a.received),
    scanned: read,
    received: rows.length,
    total,
    loadedAt: Date.now(),
  }
  cached = { key: firmQuery, registry }
  return registry
}

/** A gap: every document of this design arrived with no reference design on file. */
export function isGap(design: Design): boolean {
  return design.received > 0 && design.unidentified === design.received
}

export interface CountrySummary {
  country: string
  designs: Design[]
  received: number
  gaps: number
}

export function byCountry(designs: Design[]): CountrySummary[] {
  const map = new Map<string, CountrySummary>()
  for (const design of designs) {
    const entry = map.get(design.country) ?? { country: design.country, designs: [], received: 0, gaps: 0 }
    entry.designs.push(design)
    entry.received += design.received
    if (isGap(design)) entry.gaps++
    map.set(design.country, entry)
  }
  return [...map.values()].sort((a, b) => b.received - a.received)
}

// ── What the documents themselves say — read from a sample of details ──────

export const PROFILE_FIELDS: readonly [key: string, label: string, aliases: string[]][] = [
  ['given_names', 'Given names', ['given_name', 'first_name']],
  ['surname', 'Surname', ['last_name']],
  ['date_of_birth', 'Date of birth', ['dob', 'birth_date']],
  ['id_number', 'Document number', ['doc_number', 'document_number', 'passport_number']],
  ['expiry_date', 'Expiry date', ['expiry']],
  ['nationality', 'Nationality', []],
  ['issue_date', 'Issue date', []],
]

export interface DesignProfile {
  sampled: number
  mrzFormats: Record<string, number>
  mrzSides: Record<string, number>
  expectedSide: string | null
  mrzRead: number
  checkDigitsClean: number
  documentMatch: Record<string, number>
  fieldsRead: Record<string, number>
  samples: { id: number; front: string | null; back: string | null; created: string }[]
}

const SAMPLE_SIZE = 12
const profiles = new Map<string, DesignProfile>()

/** Reads the newest SAMPLE_SIZE documents of a design in detail. */
export async function loadProfile(design: Design): Promise<DesignProfile> {
  const key = `${design.country}/${design.docType}/${design.received}`
  const known = profiles.get(key)
  if (known) return known

  const sample = design.rows.slice(0, SAMPLE_SIZE)
  const details: VerificationDetail[] = []
  const queue = [...sample]
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const row = queue.shift()
        if (!row) return
        const result = await apiJson<VerificationDetail>(`/verifications/${row.id}`)
        if (result.ok) details.push(result.data)
      }
    }),
  )
  details.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))

  const profile: DesignProfile = {
    sampled: details.length,
    mrzFormats: {},
    mrzSides: {},
    expectedSide: null,
    mrzRead: 0,
    checkDigitsClean: 0,
    documentMatch: {},
    fieldsRead: {},
    samples: [],
  }
  for (const detail of details) {
    const bySide = detail.pipeline_response?.mrz_by_side
    if (bySide?.expected_side) profile.expectedSide = bySide.expected_side
    const mrz = mrzReading(detail)
    if (mrz) {
      profile.mrzRead++
      if (mrz.format) profile.mrzFormats[mrz.format] = (profile.mrzFormats[mrz.format] ?? 0) + 1
      const checks = Object.values(mrz.checksum_valid)
      if (checks.length && checks.every(Boolean)) profile.checkDigitsClean++
    }
    for (const side of ['front', 'back'] as const) {
      if (bySide?.[side]?.parsed) profile.mrzSides[side] = (profile.mrzSides[side] ?? 0) + 1
    }
    const match = detail.verdict_overrides?.document_match_verdict || detail.document_match_verdict
    if (match) profile.documentMatch[match] = (profile.documentMatch[match] ?? 0) + 1
    for (const [field, , aliases] of PROFILE_FIELDS) {
      if (fieldValue(detail, field, aliases)) profile.fieldsRead[field] = (profile.fieldsRead[field] ?? 0) + 1
    }
    if (profile.samples.length < 6 && (detail.images?.id_front_url || detail.images?.id_back_url)) {
      profile.samples.push({
        id: detail.id,
        front: detail.images?.id_front_url ?? null,
        back: detail.images?.id_back_url ?? null,
        created: detail.created_at ?? '',
      })
    }
  }
  profiles.set(key, profile)
  return profile
}
