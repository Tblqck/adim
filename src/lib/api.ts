/**
 * Browser-side access to the live admin API, through this app's relay
 * (src/app/api/v1/admin/[...path]). Same contract the old dashboard's
 * admin.js `adminFetch` had: the session cookie rides along, and a 401 from
 * anywhere sends the person back to sign in.
 */

import { withBase } from '@/lib/base-path'

export const ADMIN_API = withBase('/api/v1/admin')

export class NotAuthenticatedError extends Error {
  constructor() {
    super('not authenticated')
  }
}

function redirectToLogin() {
  if (typeof window === 'undefined') return
  if (window.location.pathname.startsWith(withBase('/login'))) return
  // The whole path, base included: the sign-in form sends the browser back
  // to exactly this address.
  const next = window.location.pathname + window.location.search
  window.location.href = withBase(`/login?next=${encodeURIComponent(next)}`)
}

export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(ADMIN_API + path, { credentials: 'same-origin', ...init })
  if (response.status === 401) {
    redirectToLogin()
    throw new NotAuthenticatedError()
  }
  return response
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; detail: string }

/** The server's own `detail` when it sent one, else a status line. */
async function detailOf(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
  if (body && typeof body.detail === 'string' && body.detail) return body.detail
  if (body && Array.isArray(body.detail)) return 'The server rejected the request as invalid.'
  return `${fallback} (${response.status})`
}

/**
 * JSON call that never throws for an HTTP error — it returns one, with the
 * server's message, so a page can show it. It does still throw
 * NotAuthenticatedError (the page is navigating away) and network errors.
 */
export async function apiJson<T>(path: string, init: RequestInit = {}, failure = 'Request failed'): Promise<ApiResult<T>> {
  const response = await adminFetch(path, init)
  if (!response.ok) return { ok: false, status: response.status, detail: await detailOf(response, failure) }
  return { ok: true, data: (await response.json()) as T }
}

export function jsonBody(value: unknown): RequestInit {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }
}

/** Swallow the auth redirect; surface anything else as a message. */
export function messageOf(error: unknown): string | null {
  if (error instanceof NotAuthenticatedError) return null
  return 'Network error — check the connection and try again.'
}

export async function signOut() {
  await adminFetch('/logout', { method: 'POST' }).catch(() => undefined)
  try {
    sessionStorage.clear()
  } catch {
    // Storage can be unavailable (private mode); nothing to clear then.
  }
  window.location.href = withBase('/login')
}
