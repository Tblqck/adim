import type { Metadata } from 'next'
import { VerificationReview } from '@/app/admin/verifications/[id]/review'

export const metadata: Metadata = { title: 'Review verification' }

export default async function VerificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <VerificationReview id={id} />
}
