import type { Metadata } from 'next'
import { Suspense } from 'react'
import { SignInForm } from '@/app/login/sign-in-form'

export const metadata: Metadata = { title: 'Sign in' }

/**
 * The idntory sign-in, as the current dashboard has it (admin/login.html): a
 * single centred card with the logo, Firm and Password, and a switch for
 * named team members.
 */
export default function LoginPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas px-4 py-10">
      <Suspense>
        <SignInForm />
      </Suspense>
    </div>
  )
}
