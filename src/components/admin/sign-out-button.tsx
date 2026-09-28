'use client'

import { useState } from 'react'
import { signOut } from '@/lib/api'
import { Icons } from '@/components/ui'

export function SignOutButton() {
  const [pending, setPending] = useState(false)

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setPending(true)
        void signOut()
      }}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-neutral-400 transition-colors hover:bg-neutral-800/70 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
    >
      {pending ? (
        <Icons.Spinner className="h-[18px] w-[18px] animate-spin text-neutral-500" />
      ) : (
        <Icons.LogOut className="h-[18px] w-[18px] text-neutral-500" />
      )}
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
