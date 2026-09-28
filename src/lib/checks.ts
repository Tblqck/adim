import type { MrzSide, VerificationDetail } from '@/lib/types'

/*
 * The review page's reading of a verification row — carried over unchanged
 * from the old dashboard's detail.js, including every real case that shaped
 * it. Pure functions, so the page stays about presentation.
 */

/** Canonical editable fields — the key is what goes back as corrected_fields. */
export const EDITABLE_FIELDS: readonly [key: string, label: string, aliases: string[]][] = [
  ['given_names', 'Given name', ['given_name', 'first_name']],
  ['surname', 'Surname', ['last_name']],
  ['date_of_birth', 'Date of birth', ['dob', 'birth_date']],
  ['nationality', 'Nationality', []],
  ['id_number', 'Document number', ['doc_number', 'document_number', 'passport_number']],
  ['issue_date', 'Issue date', []],
  ['expiry_date', 'Expiry', ['expiry']],
]

/**
 * The corrected_fields overlay wins, then the structured extracted_id_data
 * column, then the raw ocr_fields, then any aliases (older names / MRZ naming).
 */
export function fieldValue(row: VerificationDetail, key: string, aliases: string[] = []): string | null {
  const corrected = row.corrected_fields ?? {}
  if (corrected[key]) return corrected[key]
  const extracted = (row.extracted_id_data?.[0] ?? {}) as Record<string, unknown>
  const ocr = row.pipeline_response?.ocr_fields ?? {}
  for (const k of [key, ...aliases]) {
    const fromExtracted = extracted[k]
    if (typeof fromExtracted === 'string' && fromExtracted) return fromExtracted
    if (ocr[k]) return ocr[k]
  }
  return null
}

/** Fixed vocabularies for the per-check verdicts an admin can override. */
export const VERDICT_OPTIONS: Record<string, string[]> = {
  mrz_verdict: ['valid', 'valid_with_warnings', 'tampered', 'error'],
  face_match_verdict: ['strong_match', 'likely_match', 'weak_match', 'possible_match', 'no_match', 'skipped', 'error'],
  document_match_verdict: ['strong_match', 'likely_match', 'weak_match', 'no_match', 'no_refs', 'error'],
}

export interface MrzReading {
  passport_number: string | null
  date_of_birth: string | null
  surname: string | null
  given_names: string | null
  expiry_date: string | null
  nationality: string | null
  format: string | null
  checksum_valid: Record<string, boolean>
}

/**
 * From pipeline_response.mrz_by_side (front and back, each parsed on its own).
 * When Claude's independent MRZ re-read ran and succeeded it is the
 * authoritative transcription: the local parse it supersedes has been seen
 * to misread a digit and to jam surname and given names together. Rows from
 * before per-side capture have no mrz_by_side and correctly read as "no MRZ".
 */
export function mrzReading(row: VerificationDetail): MrzReading | null {
  const bySide = row.pipeline_response?.mrz_by_side
  if (!bySide) return null
  const reread = bySide.claude_reread
  const src: MrzSide | undefined =
    reread && reread.ok ? reread : [bySide.front, bySide.back].find((m): m is MrzSide => !!m && !!m.parsed)
  if (!src) return null
  return {
    passport_number: src.document_number || null,
    date_of_birth: src.date_of_birth_normalized || src.date_of_birth || null,
    surname: src.surname || null,
    given_names: src.given_names || null,
    expiry_date: src.expiry_date_normalized || src.expiry_date || null,
    nationality: src.nationality || null,
    format: src.format || null,
    checksum_valid: src.checksum_valid || {},
  }
}

/**
 * MRZ nationality is an ISO alpha-3 code ("NGA"); the printed side shows the
 * demonym or the country name ("NIGERIAN", "FEDERAL REPUBLIC OF NIGERIA").
 * Plain text matching never connects those, so every card flagged a correct
 * nationality as a mismatch. Not exhaustive — extend as real cards surface.
 */
const NATIONALITY_ALIASES: Record<string, string[]> = {
  NGA: ['NIGERIAN', 'NIGERIA'],
  GBR: ['BRITISH', 'UNITED KINGDOM', 'UK'],
  USA: ['AMERICAN', 'UNITED STATES', 'US'],
  DEU: ['GERMAN', 'GERMANY'],
  FRA: ['FRENCH', 'FRANCE'],
  ITA: ['ITALIAN', 'ITALY'],
  ESP: ['SPANISH', 'SPAIN'],
  PRT: ['PORTUGUESE', 'PORTUGAL'],
  NLD: ['DUTCH', 'NETHERLANDS'],
  BEL: ['BELGIAN', 'BELGIUM'],
  POL: ['POLISH', 'POLAND'],
  ROU: ['ROMANIAN', 'ROMANIA'],
  CAN: ['CANADIAN', 'CANADA'],
  BRA: ['BRAZILIAN', 'BRAZIL'],
  MEX: ['MEXICAN', 'MEXICO'],
  IND: ['INDIAN', 'INDIA'],
  CYP: ['CYPRIOT', 'CYPRUS'],
  GRC: ['GREEK', 'GREECE'],
  TUR: ['TURKISH', 'TURKEY', 'TURKIYE'],
  IRL: ['IRISH', 'IRELAND'],
  CHE: ['SWISS', 'SWITZERLAND'],
  SWE: ['SWEDISH', 'SWEDEN'],
  NOR: ['NORWEGIAN', 'NORWAY'],
  DNK: ['DANISH', 'DENMARK'],
  FIN: ['FINNISH', 'FINLAND'],
  AUT: ['AUSTRIAN', 'AUSTRIA'],
  CZE: ['CZECH', 'CZECHIA'],
  HUN: ['HUNGARIAN', 'HUNGARY'],
  UKR: ['UKRAINIAN', 'UKRAINE'],
  RUS: ['RUSSIAN', 'RUSSIA'],
  CHN: ['CHINESE', 'CHINA'],
  JPN: ['JAPANESE', 'JAPAN'],
  KOR: ['KOREAN', 'KOREA'],
  PHL: ['FILIPINO', 'FILIPINA', 'PHILIPPINES'],
  IDN: ['INDONESIAN', 'INDONESIA'],
  VNM: ['VIETNAMESE', 'VIETNAM'],
  THA: ['THAI', 'THAILAND'],
  PAK: ['PAKISTANI', 'PAKISTAN'],
  BGD: ['BANGLADESHI', 'BANGLADESH'],
  ZAF: ['SOUTH AFRICAN', 'SOUTH AFRICA'],
  KEN: ['KENYAN', 'KENYA'],
  GHA: ['GHANAIAN', 'GHANA'],
  EGY: ['EGYPTIAN', 'EGYPT'],
  ETH: ['ETHIOPIAN', 'ETHIOPIA'],
  MAR: ['MOROCCAN', 'MOROCCO'],
  DZA: ['ALGERIAN', 'ALGERIA'],
  SAU: ['SAUDI', 'SAUDI ARABIAN', 'SAUDI ARABIA'],
  ARE: ['EMIRATI', 'UNITED ARAB EMIRATES', 'UAE'],
  IRN: ['IRANIAN', 'IRAN'],
  IRQ: ['IRAQI', 'IRAQ'],
  AUS: ['AUSTRALIAN', 'AUSTRALIA'],
  NZL: ['NEW ZEALAND', 'KIWI'],
}

export interface CrossCheckRow {
  label: string
  ocrValue: string | null
  mrzValue: string | null
  match: boolean | null // null: no MRZ to compare against
}

/**
 * Printed OCR text is often bilingual or formatted differently from the MRZ
 * ("ΑΝΩΝΥΜΟΥ ANONYMOU" vs "ANONYMOU", "01/01/1970" vs "1 January 1970"), so
 * this checks containment and calendar-date equality, not string equality.
 */
export function crossCheck(row: VerificationDetail): CrossCheckRow[] {
  const ocr = row.pipeline_response?.ocr_fields ?? {}
  const mrz = mrzReading(row)

  const normText = (s: unknown) =>
    String(s ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim()
  const textMatches = (a: unknown, b: unknown) => {
    const na = normText(a)
    const nb = normText(b)
    if (!na || !nb) return false
    return na.includes(nb) || nb.includes(na) || na.split(' ').some((tok) => tok && nb.split(' ').includes(tok))
  }
  // A printed "12/08/1974" is 12 August on almost every ID, but `new Date`
  // reads it as 8 December — the old dashboard flagged real matches as
  // mismatches because of it. A US licence does print month first, so a
  // numeric date matches if either reading equals the MRZ date.
  const isoDay = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const readings = (s: string): string[] => {
    const numeric = s.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
    if (numeric) {
      const [, x, y, year] = numeric
      const pad = (v: string | undefined) => String(v).padStart(2, '0')
      return [`${year}-${pad(y)}-${pad(x)}`, `${year}-${pad(x)}-${pad(y)}`]
    }
    const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return [`${iso[1]}-${iso[2]}-${iso[3]}`]
    const parsed = new Date(s)
    return Number.isNaN(parsed.getTime()) ? [] : [isoDay(parsed)]
  }
  const dateMatches = (a: string, b: string) => {
    const ra = readings(a)
    const rb = readings(b)
    if (!ra.length || !rb.length) return textMatches(a, b)
    return ra.some((day) => rb.includes(day))
  }
  const nationalityMatches = (ocrValue: string, mrzCode: string) => {
    if (textMatches(ocrValue, mrzCode)) return true
    const aliases = NATIONALITY_ALIASES[normText(mrzCode)]
    if (!aliases) return false
    const na = normText(ocrValue)
    return aliases.some((alias) => na.includes(alias) || alias.includes(na))
  }
  // The MRZ carries the whole name in two positional slots and some parsers
  // put everything in one, while the printed side is read label by label —
  // so fall back to the full name, order-independent, before a mismatch.
  const fullName = (o: { surname?: unknown; given_names?: unknown }) =>
    normText([o.surname, o.given_names].filter(Boolean).join(' '))
  const nameMatches = (ocrValue: string, mrzValue: string | null) => {
    if (textMatches(ocrValue, mrzValue)) return true
    const a = fullName(ocr)
    const b = fullName(mrz ?? {})
    if (!a || !b) return false
    const bt = b.split(' ')
    const at = a.split(' ')
    return at.every((tok) => bt.includes(tok)) || bt.every((tok) => at.includes(tok))
  }

  const spec: [label: string, ocrKeys: string[], mrzKey: keyof MrzReading, kind: 'text' | 'date' | 'name' | 'nationality'][] = [
    ['Document number', ['id_number', 'doc_number'], 'passport_number', 'text'],
    ['Date of birth', ['dob', 'date_of_birth'], 'date_of_birth', 'date'],
    ['Surname', ['surname'], 'surname', 'name'],
    ['Given names', ['given_names'], 'given_names', 'name'],
    ['Date of expiry', ['expiry', 'expiry_date'], 'expiry_date', 'date'],
    ['Nationality', ['nationality'], 'nationality', 'nationality'],
  ]

  return spec.map(([label, ocrKeys, mrzKey, kind]) => {
    const ocrValue = ocrKeys.map((k) => ocr[k]).find(Boolean) || null
    if (!mrz) return { label, ocrValue, mrzValue: null, match: null }
    const raw = mrz[mrzKey]
    const mrzValue = typeof raw === 'string' ? raw : null
    let match = false
    if (kind === 'name') match = !!(ocrValue && nameMatches(ocrValue, mrzValue))
    else if (ocrValue && mrzValue)
      match = kind === 'date' ? dateMatches(ocrValue, mrzValue) : kind === 'nationality' ? nationalityMatches(ocrValue, mrzValue) : textMatches(ocrValue, mrzValue)
    // Some parsers leave given_names empty and put the whole name in surname.
    const shown = kind === 'name' && !mrzValue ? fullName(mrz) || null : mrzValue
    return { label, ocrValue, mrzValue: shown, match }
  })
}
