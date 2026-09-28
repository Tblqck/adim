import type { Metadata } from 'next'
import { Suspense } from 'react'
import { VerificationsList } from '@/app/admin/verifications/verifications-list'

export const metadata: Metadata = { title: 'Verifications' }

export default function VerificationsPage() {
  return (
    <Suspense>
      <VerificationsList />
    </Suspense>
  )
}
