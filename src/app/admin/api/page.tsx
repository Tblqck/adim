'use client'

import Link from 'next/link'
import { useCallback, useState, type ReactNode } from 'react'
import { PageHeader } from '@/components/admin/page-header'
import { CopyButton, Notice, Section } from '@/components/admin/kit'
import { ApiKeyPanel } from '@/components/admin/api-key-panel'
import { useAdminSession } from '@/components/admin/session-context'

// The public address firms integrate against — the same one the old
// dashboard's API page documented.
const API_BASE = 'https://18.185.59.156'

function Code({ children }: { children: string }) {
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-neutral-200">
        {children}
      </pre>
      <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
        <CopyButton value={children} />
      </div>
    </div>
  )
}

function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[12.5px] text-neutral-100">{children}</code>
}

export default function ApiPage() {
  const { me, isSuperAdmin, canManageUsers, firmId, firms } = useAdminSession()
  const [slug, setSlug] = useState<string | null>(me.firm_slug ?? null)
  const onSlug = useCallback((value: string) => setSlug(value), [])
  const shownSlug = slug || (isSuperAdmin ? firms.find((f) => f.id === firmId)?.slug : null) || 'your-firm-slug'
  const needsFirm = isSuperAdmin && !firmId

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="API"
        description="Every firm gets a slug, a dashboard password and an API key. Use the dashboard, plug the API into your own backend, or both."
      />

      {needsFirm ? (
        <Notice tone="warning">Choose a firm in the sidebar to see and manage its API key.</Notice>
      ) : (
        <ApiKeyPanel key={firmId ?? 'own'} firmId={isSuperAdmin ? firmId : null} canManage={canManageUsers} onSlug={onSlug} />
      )}

      <Section title="Credentials">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-xs text-neutral-500">
                <th className="py-2 pr-4 font-medium">Credential</th>
                <th className="py-2 pr-4 font-medium">Sent as</th>
                <th className="py-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody className="text-neutral-300">
              <tr className="border-b border-neutral-800/70">
                <td className="py-2.5 pr-4">Firm slug</td>
                <td className="py-2.5 pr-4">
                  <C>X-Client-Id</C> header
                </td>
                <td className="py-2.5">Which firm the request belongs to</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4">API key</td>
                <td className="py-2.5 pr-4">
                  <C>X-Api-Key</C> header
                </td>
                <td className="py-2.5">Authenticates the request — shown once when generated, never recoverable, only rotatable</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-neutral-400">
          The API server uses a self-signed certificate: pass <C>-k</C> to curl, or pin the certificate in your HTTP client. Base URL:{' '}
          <C>{API_BASE}</C>.
        </p>
      </Section>

      <Section title="Submit a verification directly" description="POST /api/v1/verify, authenticated with X-Client-Id and X-Api-Key.">
        <div className="space-y-4">
          <Code>{`curl -k -X POST ${API_BASE}/api/v1/verify \\
  -H "X-Client-Id: ${shownSlug}" \\
  -H "X-Api-Key: YOUR_API_KEY" \\
  -F "country=NG" \\
  -F "doc_type=passport" \\
  -F "mode=3" \\
  -F "user_ref=your_internal_applicant_id" \\
  -F "id_image=@id_front.jpg" \\
  -F "liveness_frames=@frame1.jpg" \\
  -F "liveness_frames=@frame2.jpg"`}</Code>
          <p className="text-sm leading-relaxed text-neutral-400">
            <C>mode</C>: <C>1</C> = ID + selfie (<C>-F selfie=@…</C>), <C>2</C> = ID + holding photo (<C>-F holding_photo=@…</C>), <C>3</C> = ID
            + 1–5 liveness frames. Optional <C>-F id_image_back=@…</C>. Every submission is tagged to your firm and appears in your dashboard.
          </p>
        </div>
      </Section>

      <Section
        title="Generate a hosted capture link from code"
        description="To use the hosted capture page instead of building your own camera and liveness UI."
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-neutral-400">
            Link generation needs a dashboard session, not the API key: sign in with your firm slug and password to get a cookie, then create the
            link with it. <C>X-Api-Key</C> is <strong className="text-neutral-200">not</strong> accepted here.
          </p>
          <Code>{`curl -k -c cookies.txt -X POST ${API_BASE}/api/v1/admin/login \\
  --data-urlencode "firm=${shownSlug}" \\
  --data-urlencode "password=YOUR_DASHBOARD_PASSWORD"
curl -k -b cookies.txt -X POST ${API_BASE}/api/v1/admin/sessions \\
  -H "Content-Type: application/json" \\
  -d '{"user_ref": "your_internal_applicant_id"}'`}</Code>
          <p className="text-sm leading-relaxed text-neutral-400">
            Redirect the applicant to the returned <C>url</C>. It is single-use and expires in 24 hours — only that disposable token reaches the
            applicant’s browser, never your key or password. Or use{' '}
            <Link href="/admin/links" className="text-brand-400 hover:text-brand-300">
              Generate link
            </Link>
            .
          </p>
        </div>
      </Section>
    </div>
  )
}
