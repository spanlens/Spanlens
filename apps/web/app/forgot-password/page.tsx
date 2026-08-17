'use client'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  AuthField,
  AuthFootnote,
  AuthHeading,
  AuthLayout,
  AuthNote,
  authInput,
  authLink,
  authPrimaryButton,
} from '../auth/_components/auth-shell'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    // Route the recovery link through the existing OAuth/magic-link callback,
    // which exchanges the PKCE `code` for a session and then forwards on. The
    // recovery session it establishes lets /reset-password call updateUser.
    //
    // The post-recovery destination is carried in the short-lived
    // `sl_oauth_return` cookie that /auth/callback already reads (same
    // mechanism as the OAuth-link flow in use-identities.ts), NOT a `?next=`
    // query on redirectTo. A query string is present at validation time and
    // would not match the exact Redirect URL allowlist entries in the Supabase
    // dashboard, causing a silent fallback to site_url (which drops the code on
    // the marketing root). The clean /auth/callback URL matches the allowlist
    // exactly; Supabase appends `?code=` only after validation. SameSite=Lax so
    // the cookie survives the cross-site verify bounce; the 1h lifetime matches
    // the recovery token expiry.
    if (typeof document !== 'undefined') {
      document.cookie = `sl_oauth_return=${encodeURIComponent('/reset-password')}; path=/; max-age=3600; samesite=lax`
    }
    const redirectTo = `${window.location.origin}/auth/callback`
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    // Deliberately do NOT surface "user not found": showing the same success
    // state regardless of whether the email exists prevents account
    // enumeration. Only genuinely unexpected failures (rate limit, network)
    // are shown.
    if (authError && authError.status !== 422) {
      setError(authError.message)
      setLoading(false)
      return
    }
    setSent(true)
    setLoading(false)
  }


  return (
    <AuthLayout
      pitch={{
        title: 'Locked out happens.',
        body: 'We send a single-use link. It expires in 30 minutes and can only be opened once.',
      }}
    >
      <AuthHeading title="Reset your password" subtitle="Enter the email you signed up with." />

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

        {error && <AuthNote tone="bad" live="assertive">{error}</AuthNote>}

        <button type="submit" disabled={loading} className={`${authPrimaryButton} mt-1.5`}>
          {loading ? 'Sending link…' : 'Send reset link'}
        </button>
      </form>

      {/* Deliberately non-committal: the copy reads the same whether or not the
          address has an account, which is what keeps the endpoint from being an
          account-enumeration oracle. */}
      {sent && (
        <AuthNote tone="good" live="polite" className="mt-5">
          If that address has an account, the link is on its way.
        </AuthNote>
      )}

      <AuthFootnote className="mt-[18px]">
        <Link href="/login" className={authLink}>
          Back to sign in
        </Link>
      </AuthFootnote>
    </AuthLayout>
  )
}
