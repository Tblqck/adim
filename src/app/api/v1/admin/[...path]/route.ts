import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { NextResponse, type NextRequest } from 'next/server'
import { API_SERVER_BASE, PINNED_CA } from '@/lib/server/upstream'

/**
 * The admin API relay: /api/v1/admin/* here → /api/v1/admin/* on the live
 * API server. A straight port of the old dashboard's admin_proxy.py — method,
 * query, body, cookies and Set-Cookie all pass through untouched, so the API
 * server stays the only place that authenticates, authorises and scopes a
 * request to a firm.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Headers that must not be copied verbatim between hops. accept-encoding is
// dropped so the upstream answers uncompressed and the body can be handed
// back as-is, without re-labelling its encoding.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
  'host',
  'accept-encoding',
])

const TIMEOUT_MS = 60_000

interface UpstreamResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
}

function relay(method: string, url: URL, headers: Record<string, string>, body: Buffer): Promise<UpstreamResponse> {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method,
        headers: { ...headers, 'content-length': String(body.length) },
        ...(url.protocol === 'https:' && PINNED_CA ? { ca: PINNED_CA } : {}),
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }),
        )
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('Upstream timed out')))
    req.on('error', reject)
    req.end(body)
  })
}

async function handle(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  // Each segment re-encoded on its own: an IP-ban path carries an address,
  // and a stray "/" or "?" in a segment must not change which route it hits.
  const target = new URL(`${API_SERVER_BASE}/${path.map(encodeURIComponent).join('/')}`)
  target.search = request.nextUrl.search

  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value
  })

  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? Buffer.alloc(0)
      : Buffer.from(await request.arrayBuffer())

  let upstream: UpstreamResponse
  try {
    upstream = await relay(request.method, target, headers, body)
  } catch (error) {
    console.error('[admin-relay]', request.method, target.pathname, (error as Error).message)
    return NextResponse.json({ detail: 'The verification server could not be reached.' }, { status: 502 })
  }

  const response = new NextResponse(upstream.status === 204 ? null : new Uint8Array(upstream.body), {
    status: upstream.status,
  })
  for (const [key, value] of Object.entries(upstream.headers)) {
    if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue
    if (Array.isArray(value)) {
      for (const item of value) response.headers.append(key, item)
    } else {
      response.headers.set(key, value)
    }
  }
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
