'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
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
 * Maps the `?error=<code>` query (set by /auth/callback when OAuth
 * exchange fails) to a user-facing English message. Keep keys aligned
 * with `mapOAuthError` in apps/web/app/auth/callback/route.ts.
 */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  email_conflict:
    'An account with this email already exists. Sign in with your password, then connect Google or GitHub from Settings → Sign-in methods.',
  identity_already_linked:
    'This provider is already connected to your account.',
  identity_linked_to_other_user:
    'This Google/GitHub account is already linked to a different Spanlens user. Sign in with that account, or use a different provider account.',
  manual_linking_disabled:
    'Account linking is currently disabled. Please contact support.',
  provider_disabled:
    'This sign-in method is currently unavailable. Please use another provider or email.',
  oauth_callback_failed: 'Sign-in failed. Please try again.',
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Surface OAuth callback errors. Read once on mount and clean the
  // query so the message disappears on a manual reload. `useSearchParams`
  // would force a Suspense boundary refactor on this page; reading
  // `window.location` keeps the change local. The setState happens
  // exactly once per mount, so the cascading-render concern the lint
  // rule guards against does not apply here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const errorCode = params.get('error')
    if (!errorCode) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(OAUTH_ERROR_MESSAGES[errorCode] ?? 'Sign-in failed. Please try again.')
    params.delete('error')
    const next = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${next ? `?${next}` : ''}`,
    )
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      // A user who signed up but never clicked the confirmation link gets
      // "Email not confirmed" from GoTrue. Raw wording is a dead end — route
      // them to /verify-email where they can resend the link. Match on the
      // stable `code` first (SDK ≥ 2.x) with a message fallback for older
      // error shapes. Carry the email so the page can prefill the resend.
      const code = (authError as { code?: string }).code
      if (code === 'email_not_confirmed' || /email not confirmed/i.test(authError.message)) {
        window.location.href = `/verify-email?email=${encodeURIComponent(email)}`
        return
      }
      setError(authError.message)
      setLoading(false)
      return
    }
    // Hard nav (not router.push) so the dashboard boots in a fresh JS context
    // with a re-evaluated middleware pass and an empty TanStack cache. This
    // guarantees the incoming account never renders against a previous
    // account's cached queries. See CLAUDE.md gotcha #15.
    window.location.href = '/dashboard'
  }

  async function handleOAuth(provider: 'google' | 'github') {
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (authError) {
      setError(authError.message)
      setLoading(false)
    }
    // On success the browser is redirected to the provider — no further
    // action needed here. We deliberately leave `loading` true so the
    // button stays disabled until the redirect actually navigates away.
  }

  return (
    <AuthLayout
      pitch={{
        title: 'Every model call, on the record.',
        body: 'Sign in to the workspace that already has your traces, costs and prompt versions.',
      }}
    >
      <AuthHeading title="Welcome back" subtitle="Sign in to Spanlens" />

      {/* SSO first, matching the board: the password form is the fallback. */}
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

        <AuthField
          id="password"
          label="Password"
          action={
            <Link href="/forgot-password" className={`text-[12px] font-medium ${authLink}`}>
              Forgot?
            </Link>
          }
        >
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-invalid={error ? true : undefined}
            className={authInput}
          />
        </AuthField>

        {error && <AuthNote tone="bad" live="assertive">{error}</AuthNote>}

        <button type="submit" disabled={loading} className={`${authPrimaryButton} mt-1.5`}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <AuthFootnote className="mt-[18px]">
        New here?{' '}
        <Link href="/signup" className={authLink}>
          Create an account
        </Link>
      </AuthFootnote>
    </AuthLayout>
  )
}
