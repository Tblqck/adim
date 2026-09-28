'use client'

import { useEffect, useState } from 'react'
import { apiJson } from '@/lib/api'
import type { VerificationDetail, VerificationRow } from '@/lib/types'

/*
 * The person's name for headers and lists — the white-label's
 * extractedDisplayName (full name, else given names + surname), extended to
 * every place the live server keeps a name.
 *
 * Why it cannot just read extracted_id_data.full_name: the server fills that
 * once, from OCR, when the verification is written. When OCR missed the name
 * it stays empty forever — even after the MRZ re-read found it or a reviewer
 * corrected it — so the review page showed a given name in its fields and no
 * name at the top (verification #179).
 */

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null)

function join(given: string | null, surname: string | null): string | null {
  if (given && surname) return `${given} ${surname}`
  return given ?? surname
}

/** From a full detail row: corrections, then extracted, then OCR, then the MRZ. */
export function displayNameOf(row: VerificationDetail): string | null {
  const corrected = row.corrected_fields ?? {}
  const extracted = (row.extracted_id_data?.[0] ?? {}) as Record<string, unknown>
  const ocr = (row.pipeline_response?.ocr_fields ?? {}) as Record<string, unknown>
  const bySide = row.pipeline_response?.mrz_by_side
  const mrz = bySide?.claude_reread?.ok ? bySide.claude_reread : [bySide?.front, bySide?.back].find((m) => m?.parsed)

  const pick = (key: string, ...aliases: string[]) => {
    for (const source of [corrected, extracted, ocr] as Record<string, unknown>[]) {
      for (const k of [key, ...aliases]) {
        const value = clean(source[k])
        if (value) return value
      }
    }
    return null
  }

  // A reviewer's correction of either half outranks the stored full name,
  // which was computed from the uncorrected reading.
  if (clean(corrected.given_names) || clean(corrected.surname)) {
    return join(pick('given_names', 'given_name', 'first_name'), pick('surname', 'last_name'))
  }
  return (
    clean(extracted.full_name) ||
    clean(ocr.full_name) ||
    join(pick('given_names', 'given_name', 'first_name'), pick('surname', 'last_name')) ||
    join(clean(mrz?.given_names), clean(mrz?.surname))
  )
}

/** What a list row alone can say (the list endpoint only carries full_name). */
export function listNameOf(row: VerificationRow): string | null {
  return clean(row.extracted_id_data?.[0]?.full_name)
}

// Names resolved from detail rows, kept for the session so paging back and
// forth does not refetch.
const resolved = new Map<number, string | null>()

/**
 * Names for list rows that came back without one. The live list endpoint
 * returns only extracted_id_data.full_name, so for those rows the name has
 * to come from the detail endpoint — fetched a few at a time, only for rows
 * actually on screen.
 */
export function useResolvedNames(rows: readonly VerificationRow[] | undefined): Map<number, string | null> {
  const [names, setNames] = useState<Map<number, string | null>>(() => new Map(resolved))

  useEffect(() => {
    const missing = (rows ?? []).filter((row) => !listNameOf(row) && !resolved.has(row.id)).map((row) => row.id)
    if (!missing.length) return
    let cancelled = false
    const queue = [...missing]

    async function worker() {
      while (queue.length && !cancelled) {
        const id = queue.shift()
        if (id === undefined) return
        try {
          const result = await apiJson<VerificationDetail>(`/verifications/${id}`)
          resolved.set(id, result.ok ? displayNameOf(result.data) : null)
        } catch {
          // Signed out mid-way or offline: leave it unresolved, try next load.
          return
        }
        if (!cancelled) setNames(new Map(resolved))
      }
    }

    void Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
    return () => {
      cancelled = true
    }
  }, [rows])

  return names
}

/** Resolve one row's name from its detail, through the same session cache. */
export async function resolveName(id: number): Promise<string | null> {
  if (resolved.has(id)) return resolved.get(id) ?? null
  const result = await apiJson<VerificationDetail>(`/verifications/${id}`)
  const name = result.ok ? displayNameOf(result.data) : null
  resolved.set(id, name)
  return name
}

/** Case- and accent-insensitive "contains", like the server's ilike *q*. */
export function nameContains(name: string | null, query: string): boolean {
  const fold = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  const q = fold(query)
  return !!name && !!q && fold(name).includes(q)
}

/** Best name for a list row: its own, else one resolved from its detail. */
export function rowName(row: VerificationRow, names: Map<number, string | null>): string | null {
  return listNameOf(row) ?? names.get(row.id) ?? null
}
