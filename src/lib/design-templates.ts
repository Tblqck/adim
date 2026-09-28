'use client'

import { ADMIN_API, apiJson, jsonBody, type ApiResult } from '@/lib/api'
import type { DesignTemplate, TemplateBox } from '@/lib/types'

/*
 * The AI server's approved/draft templates, through the EC2 admin relay
 * (api/production/api/routers/admin.py "Document-design templates").
 *
 * Until those relay routes are deployed on EC2 — and the AI server's ingest
 * service has been restarted to serve them — every call here comes back 404
 * or 503. templateServiceMissing() tells a page to say so instead of showing
 * an empty registry that looks like "no templates yet".
 */

export function templateServiceMissing(result: ApiResult<unknown>): boolean {
  return !result.ok && (result.status === 404 || result.status === 405 || result.status === 503)
}

export function listTemplates(params: { country?: string; doc_type?: string; status?: string } = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])
  return apiJson<{ items: DesignTemplate[]; slots?: number }>(`/templates${query.size ? `?${query}` : ''}`, {}, 'Could not load templates')
}

export function getTemplate(id: string) {
  return apiJson<DesignTemplate>(`/templates/${encodeURIComponent(id)}`, {}, 'Could not load the template')
}

/** Same-origin image URL (the session cookie rides along). `v` busts the cache after an edit. */
export function templateImageUrl(id: string, kind: 'redacted' | 'original' = 'redacted', v?: string | number) {
  return `${ADMIN_API}/templates/${encodeURIComponent(id)}/image?kind=${kind}${v ? `&v=${encodeURIComponent(String(v))}` : ''}`
}

export function saveBoxes(id: string, boxes: TemplateBox[]) {
  return apiJson<DesignTemplate>(`/templates/${encodeURIComponent(id)}/boxes`, { method: 'PUT', ...jsonBody({ boxes }) }, 'Could not save the boxes')
}

/** Approved samples per design side (the AI server's TEMPLATE_SLOTS). */
export const DEFAULT_SLOTS = 10

/** replaceId: the approved sample this one takes the slot of, when the design side is full. */
export function approveTemplate(id: string, label: string | null, replaceId?: string | null) {
  return apiJson<DesignTemplate>(
    `/templates/${encodeURIComponent(id)}/approve`,
    { method: 'POST', ...jsonBody({ label, replace_id: replaceId ?? null }) },
    'Could not approve',
  )
}

export function relabelTemplate(id: string, label: string) {
  return apiJson<DesignTemplate>(`/templates/${encodeURIComponent(id)}`, { method: 'PATCH', ...jsonBody({ label }) }, 'Could not rename')
}

export function deleteTemplate(id: string) {
  return apiJson<{ ok: boolean }>(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Could not delete')
}

/** Queue a past verification's stored photos as template drafts. */
export function backfillFromVerification(resultId: number) {
  return apiJson<{ ok: boolean; ts: string }>(`/templates/backfill/${resultId}`, { method: 'POST' }, 'Could not queue it')
}

export const BOX_KIND_LABEL: Record<TemplateBox['kind'], string> = {
  face: 'Face',
  text: 'Personal text',
  mrz: 'MRZ',
  barcode: 'Barcode / QR',
  signature: 'Signature',
  manual: 'Other personal data',
}
