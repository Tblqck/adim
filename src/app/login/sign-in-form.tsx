'use client'

import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button, Icons, Input } from '@/components/ui'
import { ADMIN_API } from '@/lib/api'
import { withBase } from '@/lib/base-path'
import { BRAND_NAME, BRAND_WORDMARK } from '@/lib/brand'

/** Same-origin absolute paths only — no open redirect through `?next=`. */
function safeNext(value: string | null): string {
  // `next` arrives as a full path (base included); the default gets the base.
  if (!value || !value.startsWith('/') || value.startsWith('//')) return withBase('/admin')
  return value
}

/**
 * The live server's three ways in, on one form (as admin/login.html):
 *   firm + password             → the firm's head admin
 *   firm + username + password  → a named team member of that firm
 *   password alone              → the platform super-admin
 */
export function SignInForm() {
  const next = safeNext(useSearchParams().get('next'))
  const [asMember, setAsMember] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    const firm = String(form.get('firm') ?? '').trim()
    const username = asMember ? String(form.get('username') ?? '').trim() : ''

    const body = new URLSearchParams({ password })
    if (firm) body.set('firm', firm)
    if (username) body.set('username', username)

    setPending(true)
    try {
      const response = await fetch(`${ADMIN_API}/login`, { method: 'POST', body, credentials: 'same-origin' })
      if (!response.ok) {
        // Always the same generic message, whatever the backend's detail says —
        // a message that differs between "no such user" and "wrong password"
        // lets someone enumerate valid usernames.
        setError(response.status === 502 ? 'Network error — try again' : 'Invalid username or password')
        return
      }
      const result = (await response.json()) as { super_admin?: boolean; display_name?: string; can_create_users?: boolean }
      // Same session flags the current dashboard sets, so both can run side by side.
      try {
        sessionStorage.setItem('kyc_super_admin', result.super_admin ? '1' : '')
        sessionStorage.setItem('kyc_display_name', result.display_name || '')
        sessionStorage.setItem('kyc_can_create_users', result.can_create_users ? '1' : '')
      } catch {
        // Storage unavailable; the dashboard reads the account from /me anyway.
      }
      window.location.href = next
    } catch {
      setError('Network error — try again')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-[360px] flex-col gap-3 rounded-2xl border border-neutral-800 bg-surface px-7 py-8 shadow-2xl shadow-black/50 animate-fade-in-up"
      noValidate
    >
      {BRAND_WORDMARK ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={BRAND_WORDMARK} alt={BRAND_NAME} className="mb-1 h-10 w-auto self-start" />
      ) : (
        <p className="text-2xl font-semibold text-white">{BRAND_NAME}</p>
      )}
      <h1 className="text-xl font-semibold tracking-tight text-white">KYC Admin</h1>
      <p className="-mt-1 mb-1 text-sm text-neutral-400">Sign in to review verifications.</p>

      <Input name="firm" placeholder="Firm" aria-label="Firm" autoComplete="organization" autoCapitalize="none" spellCheck={false} autoFocus />
      <div className="relative">
        <Input
          name="password"
          type={showPassword ? 'text' : 'password'}
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          required
          className="pr-11"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-pressed={showPassword}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-neutral-500 transition-colors hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          {showPassword ? <Icons.EyeOff className="h-4 w-4" /> : <Icons.Eye className="h-4 w-4" />}
        </button>
      </div>

      {asMember ? (
        <Input name="username" placeholder="Username" aria-label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus />
      ) : (
        <button type="button" onClick={() => setAsMember(true)} className="-mt-1 self-start text-sm text-brand-400 hover:underline">
          I’m a named team member
        </button>
      )}

      <p role="alert" className="min-h-[1.25rem] text-sm text-rose-400">
        {error ? (
          <span className="inline-flex items-center gap-1.5">
            <Icons.Alert className="h-4 w-4" />
            {error}
          </span>
        ) : null}
      </p>

      <Button type="submit" fullWidth loading={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="mt-2 text-xs leading-relaxed text-neutral-500">
        Your firm signs in with its <b className="font-semibold text-neutral-300">Firm ID</b> and password — the same details from when the
        firm was set up. A username is only for named team members.
      </p>
    </form>
  )
}
