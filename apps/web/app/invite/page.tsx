'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { writeWorkspaceCookie } from '@/lib/workspace-cookie'
import {
  AuthFootnote,
  AuthHeading,
  AuthLayout,
  AuthNote,
  authLink,
  authPrimaryButton,
  authSecondaryButton,
} from '../auth/_components/auth-shell'

/**
 * /invite?token=xxx — invitation acceptance landing page.
 *
 * This route is public (middleware.ts uses a PROTECTED_PATHS deny-list and
 * this route is not on it) so an invitee who doesn't have an account yet can
 * see what they're joining before signing up. It is noindexed via the
 * colocated layout.tsx — public for humans, hidden from crawlers.
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

const INVITE_PITCH = {
  title: 'Someone saved you a seat.',
  body: 'Accepting adds you to their workspace. Your own workspaces stay exactly as they are.',
}

/** What each org role can and cannot do, shown in the callout under the title. */
const ROLE_SUMMARY: Record<string, string> = {
  admin: 'Admins manage keys, billing and members, and can delete the workspace.',
  editor: 'Editors can run evals and edit prompts. They cannot change billing or delete the workspace.',
  viewer: 'Viewers read everything. Prompts, keys and alerts stay read-only.',
}

/** Up to two letters for the workspace avatar, e.g. "Acme AI" becomes "AA". */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

// Default export wraps the inner component in Suspense — Next.js requires
// `useSearchParams()` to live under a Suspense boundary, otherwise the
// static export step bails out (`missing-suspense-with-csr-bailout`).
export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <AuthLayout pitch={INVITE_PITCH}>
          <p className="text-[13.5px] leading-[1.6] text-text-faint" role="status">
            Verifying invitation…
          </p>
        </AuthLayout>
      }
    >
      <InvitePageInner />
    </Suspense>
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

      try {
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
      } catch {
        // Network failure while verifying — show a recoverable invalid state
        // with a hint to retry rather than leaving the page stuck on "loading".
        setStatus({
          kind: 'invalid',
          message: 'Could not reach the server. Check your connection and try again.',
        })
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

    const prevMeta = status.meta
    try {
      const res = await fetch('/api/v1/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setAcceptError(body.error ?? 'Failed to accept invitation.')
        setStatus({ kind: 'email_match', meta: prevMeta })
        return
      }

      // Switch the active workspace to the joined one so the dashboard
      // opens straight into it. The accept endpoint returns
      // `data.organizationId` exactly so the client can do this.
      const body = (await res.json().catch(() => ({}))) as {
        data?: { organizationId?: string }
      }
      if (body.data?.organizationId) writeWorkspaceCookie(body.data.organizationId)

      setStatus({ kind: 'done' })
      // Hard navigation — middleware needs to re-resolve sb-ws + onboarded
      // headers, otherwise the dashboard layout might bounce based on the
      // pre-accept request's cached state.
      setTimeout(() => { window.location.href = '/dashboard' }, 800)
    } catch {
      // Network failure — restore the interactive state so both buttons
      // re-enable and the invitee can retry. First-touch flow must recover.
      setAcceptError('Could not reach the server. Please try again.')
      setStatus({ kind: 'email_match', meta: prevMeta })
    }
  }

  async function handleDecline() {
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

    const prevMeta = status.meta
    try {
      const res = await fetch('/api/v1/invitations/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setAcceptError(body.error ?? 'Failed to decline invitation.')
        setStatus({ kind: 'email_match', meta: prevMeta })
        return
      }

      // Decline lands the user back in their own dashboard (they may not
      // have one yet — if they don't, the dashboard layout's onboarding
      // gate will sweep them to /onboarding which is the right outcome).
      // Hard navigation so middleware re-resolves sb-ws + onboarded headers
      // (mirrors the accept path). See CLAUDE.md gotcha #15.
      window.location.href = '/dashboard'
    } catch {
      // Network failure — restore the interactive state so both buttons
      // re-enable and the invitee can retry.
      setAcceptError('Could not reach the server. Please try again.')
      setStatus({ kind: 'email_match', meta: prevMeta })
    }
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    // Reload so the effect re-evaluates and shows the needs_auth state.
    router.refresh()
    window.location.reload()
  }

  if (status.kind === 'loading') {
    return (
      <AuthLayout pitch={INVITE_PITCH}>
        <p className="text-[13.5px] leading-[1.6] text-text-faint" role="status">
          Verifying invitation…
        </p>
      </AuthLayout>
    )
  }

  if (status.kind === 'invalid') {
    return (
      <AuthLayout pitch={INVITE_PITCH}>
        <AuthHeading title="Invitation unavailable" subtitle={status.message} />
        <AuthNote tone="bad">Ask whoever invited you to send a fresh link.</AuthNote>
        <AuthFootnote className="mt-[18px]">
          <Link href="/login" className={authLink}>
            Go to sign in
          </Link>
        </AuthFootnote>
      </AuthLayout>
    )
  }

  if (status.kind === 'done') {
    return (
      <AuthLayout pitch={INVITE_PITCH}>
        <AuthHeading title="Welcome aboard" subtitle="Redirecting to your dashboard…" />
        <AuthNote tone="good" live="polite">
          You are now a member of the workspace.
        </AuthNote>
      </AuthLayout>
    )
  }

  if (status.kind === 'email_mismatch') {
    return (
      <AuthLayout pitch={INVITE_PITCH}>
        <AuthHeading
          title="Wrong account"
          subtitle={
            <>
              This invitation was sent to <span className="font-mono text-text">{status.meta.email}</span>, but
              you are signed in as <span className="font-mono text-text">{status.currentEmail}</span>.
            </>
          }
        />
        <AuthNote tone="warn">Sign out, then open the invitation link again.</AuthNote>
        <button type="button" onClick={() => void handleSignOut()} className={`${authSecondaryButton} mt-5`}>
          Sign out
        </button>
      </AuthLayout>
    )
  }

  const { meta } = status
  const busy = status.kind === 'accepting'

  return (
    <AuthLayout pitch={INVITE_PITCH}>
      <div className="mb-5 flex items-center gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-bg text-[14px] font-semibold text-accent"
          aria-hidden="true"
        >
          {initials(meta.orgName)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold leading-[1.48] text-text">
            {meta.orgName}
          </span>
          <span className="block truncate font-mono text-[12px] leading-[1.48] text-text-faint">{meta.email}</span>
        </span>
      </div>

      <AuthHeading title={`Join ${meta.orgName} on Spanlens`} />

      <div className="-mt-[16px] mb-5 flex items-center gap-2">
        <span className="text-[13px] leading-[1.48] text-text-faint">You will join as</span>
        <span className="rounded-full bg-bg-chip px-2.5 py-1 text-[11.5px] font-semibold leading-[1.48] text-text">
          {meta.role}
        </span>
      </div>

      <AuthNote>{ROLE_SUMMARY[meta.role] ?? 'Access is scoped to this workspace.'}</AuthNote>

      {status.kind === 'needs_auth' ? (
        <div className="mt-5 flex flex-col gap-2.5">
          <Link
            href={`/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(meta.email)}`}
            className={authPrimaryButton}
          >
            Create account
          </Link>
          <Link
            href={`/login?next=${encodeURIComponent(`/invite?token=${token}`)}`}
            className={authSecondaryButton}
          >
            Sign in
          </Link>
        </div>
      ) : (
        <>
          {acceptError && <AuthNote tone="bad" live="assertive" className="mt-2.5">{acceptError}</AuthNote>}
          <div className="mt-5 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={busy}
              className={authPrimaryButton}
            >
              {busy ? 'Working…' : 'Accept invitation'}
            </button>
            <button
              type="button"
              onClick={() => void handleDecline()}
              disabled={busy}
              className={authSecondaryButton}
            >
              Decline
            </button>
          </div>
        </>
      )}

      <AuthFootnote className="mt-4">
        Accepting adds you to this workspace. Any workspace of your own stays as it is.
      </AuthFootnote>
    </AuthLayout>
  )
}
