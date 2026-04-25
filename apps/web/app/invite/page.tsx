'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * /invite?token=xxx — invitation acceptance landing page.
 *
 * This route is public (see middleware.ts PUBLIC_PATHS) so an invitee who
 * doesn't have an account yet can see what they're joining before signing up.
 *
 * States:
 *  - loading       — verifying token
 *  - invalid       — token missing/bad/expired/accepted
 *  - needs_auth    — valid token, user not logged in → Sign up / Sign in
 *  - email_match   — logged in with correct email → Accept
 *  - email_mismatch — logged in as someone else → Sign out
 *  - accepting     — POST accept in flight
 *  - done          — accepted, redirecting to /dashboard
 */

type InviteMeta = { email: string; role: string; orgName: string }

type Status =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'needs_auth'; meta: InviteMeta }
  | { kind: 'email_match'; meta: InviteMeta }
  | { kind: 'email_mismatch'; meta: InviteMeta; currentEmail: string }
  | { kind: 'accepting'; meta: InviteMeta }
  | { kind: 'done' }

// Default export wraps the inner component in Suspense — Next.js requires
// `useSearchParams()` to live under a Suspense boundary, otherwise the
// static export step bails out (`missing-suspense-with-csr-bailout`).
export default function InvitePage() {
  return (
    <Suspense fallback={<InviteFallback />}>
      <InvitePageInner />
    </Suspense>
  )
}

function InviteFallback() {
  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <div className="text-[13px] text-text-muted">Verifying invitation…</div>
      </div>
    </div>
  )
}

function InvitePageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [acceptError, setAcceptError] = useState('')

  useEffect(() => {
    void (async () => {
      if (!token) {
        setStatus({ kind: 'invalid', message: 'Missing invitation token.' })
        return
      }

      // Resolve invite meta from the server (public endpoint).
      const res = await fetch(`/api/v1/invitations/accept?token=${encodeURIComponent(token)}`)
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setStatus({ kind: 'invalid', message: body.error ?? 'Invalid invitation.' })
        return
      }
      const body = (await res.json()) as { data: InviteMeta }
      const meta = body.data

      // Check current auth session.
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        setStatus({ kind: 'needs_auth', meta })
        return
      }

      const currentEmail = session.user.email?.toLowerCase() ?? ''
      if (currentEmail === meta.email.toLowerCase()) {
        setStatus({ kind: 'email_match', meta })
      } else {
        setStatus({ kind: 'email_mismatch', meta, currentEmail })
      }
    })()
  }, [token])

  async function handleAccept() {
    if (status.kind !== 'email_match') return
    setAcceptError('')
    setStatus({ kind: 'accepting', meta: status.meta })

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const accessToken = session?.access_token
    if (!accessToken) {
      setAcceptError('Session expired. Please sign in again.')
      setStatus({ kind: 'needs_auth', meta: status.meta })
      return
    }

    const res = await fetch('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setAcceptError(body.error ?? 'Failed to accept invitation.')
      setStatus({ kind: 'email_match', meta: status.meta })
      return
    }

    setStatus({ kind: 'done' })
    // Soft delay so the success state is visible before navigating away.
    setTimeout(() => router.push('/dashboard'), 800)
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    // Reload so the effect re-evaluates and shows the needs_auth state.
    router.refresh()
    window.location.reload()
  }

  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <div className="flex items-center gap-2 mb-6">
          <svg width="17" height="17" viewBox="0 0 20 20" className="shrink-0">
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--text)" strokeWidth="1.5" />
            <circle cx="10" cy="10" r="3.5" fill="var(--accent)" />
          </svg>
          <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
        </div>

        {status.kind === 'loading' && (
          <div className="text-[13px] text-text-muted">Verifying invitation…</div>
        )}

        {status.kind === 'invalid' && (
          <>
            <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-2">Invitation unavailable</h1>
            <p className="text-[13px] text-text-muted leading-relaxed mb-6">{status.message}</p>
            <Link
              href="/login"
              className="inline-block font-mono text-[12px] text-accent hover:opacity-80 transition-opacity"
            >
              Go to sign in →
            </Link>
          </>
        )}

        {status.kind === 'needs_auth' && (
          <>
            <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-1">
              Join <span className="text-accent">{status.meta.orgName}</span>
            </h1>
            <p className="text-[13px] text-text-muted leading-relaxed mb-5">
              You&apos;ve been invited as{' '}
              <span className="font-mono text-text">{status.meta.role}</span>. Sign in or create an account
              with <span className="font-mono text-text">{status.meta.email}</span> to accept.
            </p>
            <div className="flex flex-col gap-2">
              <Link
                href={`/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(status.meta.email)}`}
                className="w-full bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium text-center hover:opacity-90 transition-opacity"
              >
                Create account
              </Link>
              <Link
                href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}
                className="w-full border border-border-strong py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium text-center text-text hover:bg-bg-elev transition-colors"
              >
                Sign in
              </Link>
            </div>
          </>
        )}

        {(status.kind === 'email_match' || status.kind === 'accepting') && (
          <>
            <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-1">
              Join <span className="text-accent">{status.meta.orgName}</span>
            </h1>
            <p className="text-[13px] text-text-muted leading-relaxed mb-5">
              You&apos;ll be added as{' '}
              <span className="font-mono text-text">{status.meta.role}</span>.
            </p>
            {acceptError && <p className="text-[12.5px] text-bad mb-3">{acceptError}</p>}
            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={status.kind === 'accepting'}
              className="w-full bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {status.kind === 'accepting' ? 'Accepting…' : 'Accept invitation'}
            </button>
          </>
        )}

        {status.kind === 'email_mismatch' && (
          <>
            <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-1">Wrong account</h1>
            <p className="text-[13px] text-text-muted leading-relaxed mb-5">
              This invitation was sent to{' '}
              <span className="font-mono text-text">{status.meta.email}</span>, but you&apos;re signed in as{' '}
              <span className="font-mono text-text">{status.currentEmail}</span>. Sign out and try again.
            </p>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="w-full border border-border-strong py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium text-text hover:bg-bg-elev transition-colors"
            >
              Sign out
            </button>
          </>
        )}

        {status.kind === 'done' && (
          <>
            <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-1">Welcome aboard</h1>
            <p className="text-[13px] text-text-muted leading-relaxed">Redirecting to your dashboard…</p>
          </>
        )}
      </div>
    </div>
  )
}
