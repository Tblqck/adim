import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium text-neutral-200">This page does not exist.</p>
      <Link href="/admin" className="text-sm text-brand-400 hover:text-brand-300">
        Back to the dashboard
      </Link>
    </div>
  )
}
