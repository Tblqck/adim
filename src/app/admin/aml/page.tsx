import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AmlScreening } from '@/app/admin/aml/aml-screening'

export const metadata: Metadata = { title: 'AML screening' }

export default function AmlPage() {
  return (
    <Suspense>
      <AmlScreening />
    </Suspense>
  )
}
