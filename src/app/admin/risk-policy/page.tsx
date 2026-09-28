import type { Metadata } from 'next'
import { Icons } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { NotWired } from '@/components/admin/not-wired'

export const metadata: Metadata = { title: 'Risk policy' }

export default function RiskPolicyPage() {
  return (
    <>
      <PageHeader title="Risk policy" description="The weights and thresholds that turn check results into a risk level and an automatic decision." />
      <NotWired
        icon={Icons.AlertTriangle}
        title="Not connected to the live server yet."
        description="The live pipeline's verdict rules are fixed in server code; there is no stored, editable policy for this page to show or change."
        needs={['GET  /api/v1/admin/risk-policy', 'PUT  /api/v1/admin/risk-policy']}
      />
    </>
  )
}
