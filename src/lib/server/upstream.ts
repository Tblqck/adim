import 'server-only'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Where the live verification API lives, and how to trust it.
 *
 * This dashboard has no database and no verification logic of its own — the
 * API server (development/api/production) owns all of it. Every admin call is
 * relayed there unchanged, exactly as the old FastAPI dashboard's
 * admin_proxy.py did.
 */

const DEFAULT_API = 'https://18.185.59.156/api/v1/admin'

export const API_SERVER_BASE = (process.env.API_SERVER_URL?.trim() || DEFAULT_API).replace(/\/+$/, '')

const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(API_SERVER_BASE)
// On the server this dashboard runs in its own container beside the API and
// reaches it over the private Docker network (http://api:8000): the traffic
// never leaves the host, and nginx in front already terminates TLS. That has
// to be said explicitly (API_SERVER_INTERNAL=1) -- it is never inferred.
const isInternal = process.env.API_SERVER_INTERNAL === '1'
if (API_SERVER_BASE.startsWith('http://') && !isLocal && !isInternal) {
  // The relay carries the admin password and the session cookie; plain HTTP
  // to a remote host would hand both to anyone on the path.
  throw new Error(
    'API_SERVER_URL is plain HTTP against a non-local host. Use https:// (the certificate is pinned, see certs/).',
  )
}

/**
 * The API box has no CA-trusted certificate (no domain name to issue one
 * against), so its actual self-signed certificate is pinned instead of
 * switching verification off. That still defeats an active MITM presenting a
 * different certificate, which `rejectUnauthorized: false` would not.
 */
function loadPinnedCert(): string | undefined {
  const configured = process.env.API_SERVER_CERT?.trim() || 'certs/aws_admin_cert.pem'
  const file = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured)
  try {
    return readFileSync(file, 'utf8')
  } catch {
    // No pinned file: fall back to the system CA store, which rejects a
    // self-signed server — a loud failure rather than a silent insecure one.
    return undefined
  }
}

export const PINNED_CA = loadPinnedCert()
