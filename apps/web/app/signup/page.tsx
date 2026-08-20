'use client'
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { writeWorkspaceCookie } from '@/lib/workspace-cookie'
import { TERMS_VERSION, PRIVACY_VERSION, DPA_VERSION } from '@/lib/legal-versions'
import { GithubIcon, GoogleIcon } from '@/components/ui/provider-icons'
import {
  AuthField,
  AuthFootnote,
  AuthHeading,
  AuthLayout,
  AuthNote,
  authInput,
  authLink,
  authPrimaryButton,
  authSecondaryButton,
} from '../auth/_components/auth-shell'

/**
 * Record the user's acceptance of Terms + Privacy on the new account.
 * Fire-and-forget — failure to record consent must NOT block the signup
 * flow (the user already clicked the checkbox; we don't want a transient
 * server error to lock them out of their own onboarding). The server
 * captures IP + UA from the request, not from the client body.
 *
 * If the call fails the user can still re-accept on a future prompt; we
 * surface the failure to Sentry via the standard fetch error path.
 */
async function recordSignupConsent(accessToken: string): Promise<void> {
  try {
    await fetch('/api/v1/me/consent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        documents: [
          { document: 'terms', version: TERMS_VERSION },
          { document: 'privacy', version: PRIVACY_VERSION },
          { document: 'dpa', version: DPA_VERSION },
        ],
      }),
    })
  } catch (err) {
    console.error('[signup] consent recording failed:', err)
  }
}

const SIGNUP_PITCH = {
  title: 'Start with one line of config.',
  body: 'Swap your baseURL and the first request shows up with cost, tokens and latency attached.',
}

/** Quiet underlined link used inside the two consent paragraphs. */
function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      className="text-text-muted underline underline-offset-2 transition-colors hover:text-text"
    >
      {children}
    </Link>
  )
}

// Default export wraps the inner form in Suspense — Next.js requires
// `useSearchParams()` to live under a Suspense boundary, otherwise the
// static export step bails out (`missing-suspense-with-csr-bailout`).
export default function SignupPage() {
  return (
    <Suspense fallback={<SignupFallback />}>
      <SignupPageInner />
    </Suspense>
  )
}

function SignupFallback() {
  return (
    <AuthLayout pitch={SIGNUP_PITCH}>
      <p className="text-[13.5px] leading-[1.6] text-text-faint" role="status">
        Loading…
      </p>
    </AuthLayout>
  )
}

function SignupPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const inviteToken = params.get('invite')
  const prefillEmail = params.get('email') ?? ''
  // Prefill email from invitation link at mount via lazy init — the server
  // issues invitations bound to a specific email, so typing a different one
  // would just fail on accept. After mount the user controls the value.
  const [email, setEmail] = useState(() => prefillEmail)
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleOAuth(provider: 'google' | 'github') {
    setError('')
    setLoading(true)
    const supabase = createClient()
    // The callback route records Terms + Privacy consent automatically
    // on first sign-in for OAuth users — the implicit-consent notice
    // shown next to the SSO buttons covers the explicit acknowledgement.
    const callback = `${window.location.origin}/auth/callback`
    const next = inviteToken
      ? `${callback}?next=${encodeURIComponent(`/invite?token=${inviteToken}`)}`
      : callback
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: next },
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!consent) {
      setError('You must agree to the Terms of Service and Privacy Policy to continue.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { data: signupData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }

    // Record consent immediately after signUp succeeds. The session JWT
    // is only present on local Supabase (auto-confirm) or when email
    // confirmation is disabled — in the email-confirmation path we lose
    // the chance to record consent at this exact moment, but the user
    // clicked the checkbox before we accepted the request, so the
    // contract is formed at this point regardless of whether we
    // persisted it server-side.
    if (signupData.session?.access_token) {
      await recordSignupConsent(signupData.session.access_token)
    }

    // Invitation flow: skip onboarding, auto-accept the invite, go to dashboard.
    // signUp returns a session on local Supabase (no email confirmation); in
    // prod the session may be null until the confirmation link is clicked —
    // in that case we defer acceptance to /invite after the user clicks through.
    if (inviteToken && signupData.session?.access_token) {
      const accept = await fetch('/api/v1/invitations/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${signupData.session.access_token}`,
        },
        body: JSON.stringify({ token: inviteToken }),
      })
      if (accept.ok) {
        const acceptBody = (await accept.json().catch(() => ({}))) as { data?: { organizationId?: string } }
        if (acceptBody.data?.organizationId) writeWorkspaceCookie(acceptBody.data.organizationId)
        window.location.href = '/dashboard'
        return
      }
      // Fall through: account was created but accept failed. Send them to
      // /invite which will show the error clearly with options.
      window.location.href = `/invite?token=${encodeURIComponent(inviteToken)}`
      return
    }

    // Standard signup: defer workspace creation to /onboarding, where the
    // user names their workspace and answers the survey. The dashboard
    // layout's `if (!orgId || !onboardedAt) redirect('/onboarding')` guard
    // means we don't even need to push them — but we do anyway so the
    // address bar updates immediately rather than after a server round-trip.
    if (signupData.session?.access_token) {
      router.push('/onboarding')
      return
    }

    // No session in response — email confirmation is likely required. Show
    // the "check your inbox" state; on first sign-in /login will land on
    // /dashboard, the layout will see no orgId, and route to /onboarding.
    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <AuthLayout pitch={SIGNUP_PITCH}>
        <AuthHeading
          title="Check your inbox"
          subtitle={
            <>
              We sent a confirmation link to <span className="font-mono text-text">{email}</span>. Open it to
              activate your account and finish setting up your workspace.
            </>
          }
        />
        <AuthNote tone="good" live="polite">
          Nothing yet? Check spam, the link can take a minute.
        </AuthNote>
        <AuthFootnote className="mt-[18px]">
          <Link href="/login" className={authLink}>
            Back to sign in
          </Link>
        </AuthFootnote>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout pitch={SIGNUP_PITCH}>
      <AuthHeading title="Create your workspace" subtitle="Free plan, 50k requests a month, no card." />

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => void handleOAuth('github')}
          disabled={loading}
          className={authSecondaryButton}
        >
          <GithubIcon className="size-[18px] shrink-0" />
          <span>Continue with GitHub</span>
        </button>
        <button
          type="button"
          onClick={() => void handleOAuth('google')}
          disabled={loading}
          className={authSecondaryButton}
        >
          <GoogleIcon className="size-[18px] shrink-0" />
          <span>Continue with Google</span>
        </button>
      </div>

      {/* SSO has no checkbox, so the acknowledgement has to be stated inline. */}
      <p className="mt-3 text-[11.5px] leading-[1.6] text-text-faint">
        Continuing with GitHub or Google means you agree to the <LegalLink href="/terms">Terms of Service</LegalLink>,
        the <LegalLink href="/privacy">Privacy Policy</LegalLink> and the{' '}
        <LegalLink href="/dpa">Data Processing Addendum</LegalLink>.
      </p>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-track" />
        <span className="font-mono text-[11.5px] leading-[1.48] text-text-faint">or</span>
        <span className="h-px flex-1 bg-track" />
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <AuthField id="email" label="Work email">
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            aria-invalid={error ? true : undefined}
            className={authInput}
          />
        </AuthField>

        <AuthField id="password" label="Password">
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            minLength={8}
            required
            aria-invalid={error ? true : undefined}
            className={authInput}
          />
        </AuthField>

        {/* Explicit opt-in, kept as a real checkbox rather than the board's
            passive footer sentence: `handleSubmit` refuses to run without it
            and the server records the acceptance against the new account. */}
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
          />
          <span className="text-[11.5px] leading-[1.6] text-text-faint">
            I agree to the <LegalLink href="/terms">Terms of Service</LegalLink>, the{' '}
            <LegalLink href="/privacy">Privacy Policy</LegalLink> and the{' '}
            <LegalLink href="/dpa">Data Processing Addendum</LegalLink>.
          </span>
        </label>

        {error && <AuthNote tone="bad" live="assertive">{error}</AuthNote>}

        <button type="submit" disabled={loading || !consent} className={`${authPrimaryButton} mt-1.5`}>
          {loading ? 'Creating workspace…' : 'Create workspace'}
        </button>
      </form>

      <AuthFootnote className="mt-[18px]">
        Already have an account?{' '}
        <Link href="/login" className={authLink}>
          Sign in
        </Link>
      </AuthFootnote>
    </AuthLayout>
  )
}
