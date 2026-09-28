import type { Metadata } from 'next'
import { Icons } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { NotWired } from '@/components/admin/not-wired'

export const metadata: Metadata = { title: 'Audit log' }

// The finished page is ./audit-log.tsx. It goes back in here (render
// <AuditLog />) once the server side in deploy/audit-log/ is live on the API.
export default function AuditLogPage() {
  return (
    <>
      <PageHeader title="Audit log" description="Who did what, and when: sign-ins, reviews, screens, document checks, links, deletions and account changes." />
      <NotWired
        icon={Icons.History}
        title="Coming soon."
        description="The audit log is built and switches on once the server update is deployed."
        needs={['GET  /api/v1/admin/audit']}
      />
    </>
  )
}
