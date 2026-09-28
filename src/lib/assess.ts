import type { StatusTone } from '@/components/ui'
import { crossCheck, EDITABLE_FIELDS, fieldValue, mrzReading } from '@/lib/checks'
import { docTypeLabel, fmtPct, humanize } from '@/lib/format'
import { countryByCode } from '@/lib/countries'
import type { VerificationDetail, VerificationRow } from '@/lib/types'

/*
 * What the automated checks found, as things for a person to look at — the
 * white-label's review assessment (src/lib/review/assess.ts there), built
 * from what the live pipeline stores.
 *
 * The live server hands back one combined verdict ("mrz_tampered", "fail",
 * "both_weak") and a pass/fail flag. That reads as a decision the machine
 * already made. It is not one: an admin decides. So the verdict is taken
 * apart into the individual findings behind it — each named, explained, and
 * pointing at its evidence — and the headline says only how much there is
 * to look at, never "passed" or "failed".
 *
 * A reviewer's verdict override counts as the check's result: after a person
 * has looked at a face and overridden "no_match", the finding goes away.
 */

export type ReviewTab = 'overview' | 'scores' | 'template' | 'mrz' | 'cross' | 'forensics' | 'pep'
export type IssueSeverity = 'danger' | 'warning' | 'info'

export interface ReviewIssue {
  key: string
  severity: IssueSeverity
  title: string
  description: string
  /** Where the evidence lives. */
  tab: ReviewTab
  linkLabel: string
  /** Both readings, when the issue is a disagreement between them. */
  values?: { printed: string | null; mrz: string | null }
  /** Named items behind the finding (failed check digits, risk flags…). */
  items?: string[]
}

export type ResultKind = 'SIGNIFICANT_ISSUES' | 'NEEDS_REVIEW' | 'NOT_ENOUGH_DATA' | 'NO_ISSUES'

export const RESULT_LABEL: Record<ResultKind, string> = {
  SIGNIFICANT_ISSUES: 'Significant issues',
  NEEDS_REVIEW: 'Needs review',
  NOT_ENOUGH_DATA: 'Not enough data',
  NO_ISSUES: 'No issues detected',
}

export const RESULT_TONE: Record<ResultKind, StatusTone> = {
  SIGNIFICANT_ISSUES: 'danger',
  NEEDS_REVIEW: 'warning',
  NOT_ENOUGH_DATA: 'muted',
  NO_ISSUES: 'success',
}

export interface Assessment {
  kind: ResultKind
  label: string
  summary: string
  /** Most serious first. Info items are context, not counted as attention. */
  issues: ReviewIssue[]
  attentionCount: number
  countByTab: Partial<Record<ReviewTab, number>>
}

const pct = (v: number | null | undefined) => fmtPct(v)

function effective(row: VerificationDetail, key: 'face_match_verdict' | 'document_match_verdict' | 'mrz_verdict'): string | null {
  return row.verdict_overrides?.[key] || row[key] || null
}

function parseDay(value: string | null): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  // Printed expiry dates are day-first on almost every ID.
  const dmy = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
  return null
}

const FLAG_LABEL: Record<string, string> = {
  missing_exif: 'No camera metadata (EXIF)',
  elevated_ela: 'Raised error-level-analysis score',
  editing_software: 'Editing software signature',
  resave_detected: 'Image looks re-saved',
  gps_present: 'GPS location embedded',
}

interface SecondOpinion {
  ok?: boolean
  face_assessment?: 'matches' | 'does_not_match' | 'uncertain' | 'unavailable'
  face_reason?: string
  corrections?: { field: string; was: string | null; now: string }[]
  notes?: string
}

interface FaceDetail {
  arcface_match?: boolean
  adaface_match?: boolean
  arcface_similarity?: number
  adaface_similarity?: number
  error?: string
}

export function assessVerification(row: VerificationDetail): Assessment {
  const issues: ReviewIssue[] = []
  const add = (issue: ReviewIssue) => issues.push(issue)
  const pipeline = (row.pipeline_response ?? {}) as Record<string, unknown>
  const second = (pipeline.second_opinion ?? null) as SecondOpinion | null
  const face = (pipeline.face ?? {}) as FaceDetail
  const docName = [countryByCode(row.country)?.name ?? row.country, docTypeLabel(row.doc_type)].filter(Boolean).join(' ')
  const missingChecks: string[] = []

  // ── Face ──────────────────────────────────────────────────────────────
  const faceVerdict = effective(row, 'face_match_verdict')
  const secondFace =
    second?.ok && second.face_assessment && second.face_assessment !== 'unavailable'
      ? ` Claude's second look: ${second.face_assessment === 'matches' ? 'matches' : second.face_assessment === 'does_not_match' ? 'does not match' : 'uncertain'}${second.face_reason ? ` — ${second.face_reason}` : ''}.`
      : ''
  const modelsDisagree = face.arcface_match !== undefined && face.adaface_match !== undefined && face.arcface_match !== face.adaface_match
  if (faceVerdict === 'no_match') {
    add({
      key: 'face-no-match',
      severity: 'danger',
      title: 'Face does not match the document photo',
      description: `The face captured does not match the portrait on the document (similarity ${pct(row.face_match_score)}).${secondFace} Compare the photographs yourself before deciding.`,
      tab: 'scores',
      linkLabel: 'Open model scores',
    })
  } else if (modelsDisagree) {
    add({
      key: 'face-models-disagree',
      severity: 'danger',
      title: 'The two face models disagree',
      description: `One face model says the person matches the document and the other says they do not (ArcFace ${pct(face.arcface_similarity)}, AdaFace ${pct(face.adaface_similarity)}). Disagreement between independent models is a common sign of a substituted photo.${secondFace}`,
      tab: 'scores',
      linkLabel: 'Open model scores',
    })
  } else if (faceVerdict === 'weak_match' || faceVerdict === 'possible_match') {
    add({
      key: 'face-weak',
      severity: 'warning',
      title: 'Face match is weak',
      description: `The face resembles the document portrait but not strongly (similarity ${pct(row.face_match_score)}).${secondFace} Look at the photographs side by side.`,
      tab: 'scores',
      linkLabel: 'Open model scores',
    })
  } else if (faceVerdict === 'error') {
    add({
      key: 'face-error',
      severity: 'warning',
      title: 'Face comparison could not run',
      description: `No face comparison result${face.error ? ` (${face.error})` : ''}. It has not found anything either way — compare the photographs yourself.`,
      tab: 'scores',
      linkLabel: 'Open model scores',
    })
  } else if (faceVerdict === 'skipped') {
    add({
      key: 'face-skipped',
      severity: 'warning',
      title: 'Face was not compared',
      description: 'The face check was skipped for this verification, so nothing confirms the person is the document holder.',
      tab: 'scores',
      linkLabel: 'Open model scores',
    })
  } else if (!faceVerdict) {
    missingChecks.push('face match')
  }
  if (second?.ok && second.face_assessment === 'does_not_match' && (faceVerdict === 'strong_match' || faceVerdict === 'likely_match')) {
    add({
      key: 'face-second-opinion',
      severity: 'warning',
      title: 'Second opinion disagrees on the face',
      description: `The face models found a match, but Claude's review did not${second.face_reason ? `: ${second.face_reason}` : '.'} The models decide the verdict; this is advisory — worth a look.`,
      tab: 'scores',
      linkLabel: 'Open model scores',
    })
  }

  // ── Liveness (only captured with live frames) ─────────────────────────
  if (row.verification_mode === 3) {
    if (row.liveness_verdict === 'fail') {
      add({
        key: 'liveness-fail',
        severity: 'danger',
        title: 'Liveness check failed',
        description: `The live frames did not pass the anti-spoofing check (score ${pct(row.liveness_score)}). This can mean a photo or screen was held up to the camera.`,
        tab: 'scores',
        linkLabel: 'Open model scores',
      })
    } else if (!row.liveness_verdict) {
      missingChecks.push('liveness')
    }
    if (row.liveness_method && row.liveness_method !== 'onnx') {
      add({
        key: 'liveness-fallback',
        severity: 'warning',
        title: 'Liveness came from the fallback method',
        description: 'The anti-spoofing model did not run, so liveness was judged on image sharpness alone — a much weaker signal. Treat a pass here with caution.',
        tab: 'scores',
        linkLabel: 'Open model scores',
      })
    }
  }

  // ── Document design ───────────────────────────────────────────────────
  const docVerdict = effective(row, 'document_match_verdict')
  if (docVerdict === 'no_match') {
    add({
      key: 'document-no-match',
      severity: 'danger',
      title: 'Document does not match its reference design',
      description: `The document was compared with reference images for a ${docName || 'document of this type'} and did not match (score ${pct(row.document_match_score)}). It may be a different document type, a poor photo, or not genuine.`,
      tab: 'scores',
      linkLabel: 'Open model scores',
    })
  } else if (docVerdict === 'weak_match') {
    add({
      key: 'document-weak',
      severity: 'warning',
      title: 'Document only weakly matches its reference design',
      description: `The document resembles reference images for a ${docName || 'document of this type'} but not closely (score ${pct(row.document_match_score)}). Review the photographs.`,
      tab: 'scores',
      linkLabel: 'Open model scores',
    })
  } else if (docVerdict === 'no_refs') {
    add({
      key: 'document-unidentified',
      severity: 'warning',
      title: 'Document could not be identified',
      description: `The document appears to be ${docName ? `a ${docName}` : 'this type'}, but there is no reference design on file to compare it with. A design not in the library yet looks exactly like this — review the photographs directly.`,
      tab: 'scores',
      linkLabel: 'Review document',
    })
  } else if (docVerdict === 'error') {
    add({
      key: 'document-error',
      severity: 'warning',
      title: 'Document comparison could not run',
      description: 'The reference-design comparison failed, so it has found nothing either way.',
      tab: 'scores',
      linkLabel: 'Open model scores',
    })
  }

  // ── Approved template of this design (AI server) ─────────────────────
  for (const side of Object.values(row.pipeline_response?.template_match ?? {})) {
    const where = `${side.side} side`
    if (side.status === 'compared' && side.verdict === 'no_match') {
      add({
        key: `template-no-match-${side.side}`,
        severity: 'danger',
        title: `Document design differs from the approved template (${where})`,
        description: `Compared on design alone — faces, names, numbers and the MRZ left out, lighting corrected — this ${docName || 'document'} does not match the approved template (score ${pct(side.score)}). It may be a different version of the document, or not genuine. Compare the frames.`,
        tab: 'template',
        linkLabel: 'Compare frames',
      })
    } else if (side.status === 'compared' && side.verdict === 'weak_match') {
      add({
        key: `template-weak-${side.side}`,
        severity: 'warning',
        title: `Only a weak match with the approved template (${where})`,
        description: `The design resembles the approved template but not closely (score ${pct(side.score)}). Compare the frames.`,
        tab: 'template',
        linkLabel: 'Compare frames',
      })
    } else if (side.status === 'insufficient') {
      add({
        key: `template-insufficient-${side.side}`,
        severity: 'warning',
        title: `Too little of the card could be compared with its template (${where})`,
        description: 'Glare, shadow or a poor crop hid most of the design, so the template check says nothing either way. Compare the photographs yourself.',
        tab: 'template',
        linkLabel: 'Open template match',
      })
    } else if (side.status === 'no_templates') {
      add({
        key: `template-none-${side.side}`,
        severity: 'info',
        title: `No approved template for this design yet (${where})`,
        description: side.draft?.created
          ? 'This document was offered as a draft template. Once an admin approves it, documents of this design are compared against it.'
          : 'Documents of this design are not compared against a template until one is approved in Templates.',
        tab: 'template',
        linkLabel: 'Open template match',
      })
    }
  }

  // ── Machine-readable zone ─────────────────────────────────────────────
  const mrzVerdict = effective(row, 'mrz_verdict')
  const mrz = mrzReading(row)
  const bySide = row.pipeline_response?.mrz_by_side
  const failedDigits = mrz ? Object.entries(mrz.checksum_valid).filter(([, ok]) => !ok).map(([k]) => humanize(k)) : []
  if (mrzVerdict === 'tampered') {
    add({
      key: 'mrz-tampered',
      severity: 'danger',
      title: 'MRZ check digits failed',
      description:
        'The machine-readable zone was read, but its check digits do not add up. Either the zone was misread or the document has been altered — compare it with the photograph.',
      tab: 'mrz',
      linkLabel: 'Open MRZ',
      items: failedDigits.length ? failedDigits.map((d) => `${d} check digit`) : undefined,
    })
  } else if (mrzVerdict === 'valid_with_warnings') {
    add({
      key: 'mrz-warning',
      severity: 'warning',
      title: 'MRZ passed with warnings',
      description: 'The machine-readable zone validated, but not cleanly.',
      tab: 'mrz',
      linkLabel: 'Open MRZ',
      items: failedDigits.length ? failedDigits.map((d) => `${d} check digit`) : undefined,
    })
  } else if (mrzVerdict === 'error') {
    add({
      key: 'mrz-error',
      severity: 'warning',
      title: 'MRZ could not be read',
      description: 'A machine-readable zone was expected but could not be parsed, so nothing on the document was cross-checked against it.',
      tab: 'mrz',
      linkLabel: 'Open MRZ',
    })
  }
  const unreadableSide = bySide ? (['front', 'back'] as const).find((s) => bySide[s] && !bySide[s]?.parsed) : undefined
  if (unreadableSide && !mrz) {
    add({
      key: 'mrz-unreadable',
      severity: 'warning',
      title: `MRZ found on the ${unreadableSide} but unreadable`,
      description: 'A machine-readable zone was detected but could not be read — often glare or blur. A retake would let it be checked.',
      tab: 'mrz',
      linkLabel: 'Open MRZ',
    })
  } else if (bySide?.expected_side && !bySide.front && !bySide.back) {
    add({
      key: 'mrz-missing',
      severity: 'warning',
      title: 'No MRZ where one is expected',
      description: `This document type carries a machine-readable zone on the ${bySide.expected_side}, and none was found. The wrong side may have been photographed, or the document is not what it claims to be.`,
      tab: 'mrz',
      linkLabel: 'Open MRZ',
    })
  }
  if (bySide?.claude_reread?.ok) {
    add({
      key: 'mrz-reread',
      severity: 'info',
      title: 'MRZ recovered by a second read',
      description: "The first reading of the machine-readable zone failed its check digits; Claude's independent re-read passed them and is used here.",
      tab: 'mrz',
      linkLabel: 'Open MRZ',
    })
  }

  // ── Printed against the MRZ ───────────────────────────────────────────
  for (const check of crossCheck(row)) {
    if (check.match === false && check.ocrValue && check.mrzValue) {
      add({
        key: `cross-${check.label}`,
        severity: 'warning',
        title: `${check.label}: printed and MRZ values differ`,
        description: `The ${check.label.toLowerCase()} printed on the document does not match the one encoded in its machine-readable zone.`,
        tab: 'cross',
        linkLabel: 'Open cross-check',
        values: { printed: check.ocrValue, mrz: check.mrzValue },
      })
    }
  }

  // ── Fields that were not read ─────────────────────────────────────────
  const notRead = EDITABLE_FIELDS.filter(([key]) => ['given_names', 'surname', 'date_of_birth', 'id_number'].includes(key))
    .filter(([key, , aliases]) => !fieldValue(row, key, aliases) && !(key === 'id_number' && mrz?.passport_number))
    .map(([, label]) => label)
  if (notRead.length) {
    add({
      key: 'fields-missing',
      severity: 'warning',
      title: 'Identity fields not read',
      description: 'These were not read from the document. Check the photographs and, if the values are visible, enter them with Edit values.',
      tab: 'overview',
      linkLabel: '',
      items: notRead,
    })
  }

  // ── Expiry, judged on the day it was submitted ────────────────────────
  const expiry = parseDay(fieldValue(row, 'expiry_date', ['expiry']) ?? mrz?.expiry_date ?? null)
  const submitted = row.created_at ? new Date(row.created_at) : new Date()
  if (expiry && expiry < submitted) {
    add({
      key: 'document-expired',
      severity: 'danger',
      title: 'Document had expired when submitted',
      description: `It expired on ${expiry.toLocaleDateString()}, before this verification was submitted.`,
      tab: 'overview',
      linkLabel: '',
    })
  }

  // ── Image forensics ───────────────────────────────────────────────────
  const fr = row.forensics_result
  if (!fr) missingChecks.push('forensics')
  else if (fr.verdict === 'suspicious') {
    add({
      key: 'forensics-suspicious',
      severity: 'warning',
      title: 'Document image shows signs of editing',
      description: 'Tamper heuristics flagged the image. This means look closer, not reject — phone apps and messaging services trigger some of these too.',
      tab: 'forensics',
      linkLabel: 'Open forensics',
      items: (fr.risk_flags ?? []).map((flag) => FLAG_LABEL[flag] ?? humanize(flag)),
    })
  }

  // ── PEP & sanctions ───────────────────────────────────────────────────
  const pep = row.pep_result
  if (!pep) missingChecks.push('PEP & sanctions screening')
  else if (pep.risk_classification === 'POTENTIAL_MATCH') {
    const sanctioned = (pep.matches ?? []).some((m) => (m.topics ?? []).some((t) => t.startsWith('sanction') || t.startsWith('crime') || t === 'wanted'))
    add({
      key: 'screening-match',
      severity: sanctioned ? 'danger' : 'warning',
      title: sanctioned ? 'Possible sanctions match' : 'Possible PEP match',
      description: sanctioned
        ? 'The name matched a person on a sanctions or law-enforcement list. Confirm or rule out the match before approving.'
        : 'The name matched a politically exposed person. That calls for enhanced due diligence, not automatic rejection.',
      tab: 'pep',
      linkLabel: 'Open screening',
      items: (pep.matches ?? []).slice(0, 5).map((m) => `${m.name} — ${pct(m.score)}`),
    })
  } else if (pep.error || (pep.risk_classification && pep.risk_classification !== 'CLEAN')) {
    add({
      key: 'screening-unavailable',
      severity: 'warning',
      title: 'Screening could not run',
      description: `PEP & sanctions screening did not complete${pep.error ? ` (${pep.error})` : ''}. A screen that could not run has not cleared the person.`,
      tab: 'pep',
      linkLabel: 'Open screening',
    })
  }

  // ── Second-opinion corrections (context) ──────────────────────────────
  if (second?.ok && second.corrections?.length) {
    add({
      key: 'second-opinion-corrections',
      severity: 'info',
      title: 'Fields corrected by a second read',
      description: "Claude's review corrected these values from the first reading; the corrected values are the ones shown.",
      tab: 'overview',
      linkLabel: '',
      items: second.corrections.map((c) => `${humanize(c.field)}: ${c.was ?? '—'} → ${c.now}`),
    })
  }

  if (missingChecks.length) {
    add({
      key: 'incomplete',
      severity: 'warning',
      title: 'Assessment is incomplete',
      description:
        'These checks have not produced a result, so nothing above covers them. A check that could not run has not found anything either way. Forensics and screening arrive a few seconds after submission.',
      tab: 'overview',
      linkLabel: '',
      items: missingChecks,
    })
  }

  const rank: Record<IssueSeverity, number> = { danger: 0, warning: 1, info: 2 }
  issues.sort((a, b) => rank[a.severity] - rank[b.severity])

  const attention = issues.filter((i) => i.severity !== 'info')
  const countByTab: Partial<Record<ReviewTab, number>> = {}
  for (const issue of attention) countByTab[issue.tab] = (countByTab[issue.tab] ?? 0) + 1

  const hasDanger = attention.some((i) => i.severity === 'danger')
  const onlyIncomplete = attention.length === 1 && attention[0]?.key === 'incomplete'
  const kind: ResultKind = hasDanger ? 'SIGNIFICANT_ISSUES' : onlyIncomplete ? 'NOT_ENOUGH_DATA' : attention.length ? 'NEEDS_REVIEW' : 'NO_ISSUES'
  const summary =
    kind === 'NO_ISSUES'
      ? 'Every check that ran came back clean.'
      : kind === 'NOT_ENOUGH_DATA'
        ? 'Some checks have no result yet.'
        : `${attention.length} item${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} attention.`

  return { kind, label: RESULT_LABEL[kind], summary, issues, attentionCount: attention.length, countByTab }
}

/**
 * The list page only has the combined verdict code, so it names the main
 * finding behind it — as a warning, not a pass/fail — and the review page
 * lists the rest.
 */
const VERDICT_FINDING: Record<string, { label: string; tone: StatusTone }> = {
  pass: { label: 'No issues found', tone: 'success' },
  mrz_face_pass: { label: 'Document not identified', tone: 'warning' },
  face_only_pass: { label: 'Only the face was checked', tone: 'warning' },
  pass_mrz_warn: { label: 'MRZ warning', tone: 'warning' },
  both_weak: { label: 'Weak face & document match', tone: 'warning' },
  face_ai_mismatch: { label: 'Face models disagree', tone: 'danger' },
  mrz_unreadable: { label: 'MRZ unreadable', tone: 'warning' },
  mrz_tampered: { label: 'MRZ check failed', tone: 'danger' },
  liveness_fail: { label: 'Liveness failed', tone: 'danger' },
  fail: { label: 'Face & document don’t match', tone: 'danger' },
}

export function listFinding(row: VerificationRow): { label: string; tone: StatusTone } {
  const code = (row.overall_verdict ?? '').toLowerCase()
  return VERDICT_FINDING[code] ?? (code ? { label: humanize(code), tone: 'warning' } : { label: 'Awaiting checks', tone: 'muted' })
}

/** A person's decision, when there is one — kept apart from what the checks found. */
export function decisionOf(row: VerificationRow): { label: string; tone: StatusTone } | null {
  if (!row.reviewed) return null
  const by = row.reviewed_by ? ` by ${row.reviewed_by}` : ''
  return row.verified ? { label: `Approved${by}`, tone: 'success' } : { label: `Rejected${by}`, tone: 'danger' }
}
