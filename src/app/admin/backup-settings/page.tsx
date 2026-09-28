import type { Metadata } from 'next'
import { Icons } from '@/components/ui'
import { PageHeader } from '@/components/admin/page-header'
import { NotWired } from '@/components/admin/not-wired'

export const metadata: Metadata = { title: 'Backup' }

export default function BackupSettingsPage() {
  return (
    <>
      <PageHeader title="Backup" description="Database and document-storage backups: schedule, last run and restore points." />
      <NotWired
        icon={Icons.Refresh}
        title="Not connected to the live server yet."
        description="The live database and document storage run on Supabase; their backups are not exposed through the API, so there is no status for this page to read."
        needs={['GET  /api/v1/admin/backups']}
      />
    </>
  )
}
