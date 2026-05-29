'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function LogoMark() {
  return (
    <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
      <Image src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" priority />
      <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
    </Link>
  )
}

function ProofRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-[7px] border-b border-dashed border-border">
      <span className="font-mono text-[11px] text-text-faint tracking-[0.03em]">{k}</span>
      <span className="font-mono text-[11.5px] text-text">{v}</span>
    </div>
  )
}

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
    <div className="min-h-screen bg-bg-elev grid grid-cols-2">

      {/* ── Left pane, product proof ─────────────────────────────── */}
      <div className="bg-bg border-r border-border p-10 flex flex-col justify-between">
        <div>
          <LogoMark />
          <div className="mt-12 max-w-[400px]">
            <h2 className="text-[34px] font-medium tracking-[-1px] leading-[1.1] [text-wrap:balance]">
              Lost your key?<br />
              <span className="text-text-muted">We&apos;ll cut a new one.</span>
            </h2>
            <p className="text-[14px] text-text-muted leading-[1.55] mt-4">
              Enter your email and we&apos;ll send a secure link to reset your password.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-0 max-w-[420px] mt-9">
          <ProofRow k="ingested this month" v="412,881,204 calls" />
          <ProofRow k="p99 logging overhead" v="2.8ms" />
          <ProofRow k="teams saving money" v="$7.2M / mo · aggregate" />
          <ProofRow k="self-hostable" v="Helm · Docker · binary" />
        </div>
      </div>

      {/* ── Right pane, form ────────────────────────────────────────── */}
      <div className="flex items-center justify-center p-10">
        <div className="w-[360px] max-w-full">
          {sent ? (
            <div className="text-center">
              <div className="w-9 h-9 rounded-full bg-accent-bg border border-accent-border flex items-center justify-center mx-auto mb-3 font-mono text-[14px] text-accent">✉</div>
              <div className="text-[16px] font-medium tracking-[-0.2px] mb-1.5">Check your inbox.</div>
              <div className="text-[12.5px] text-text-muted leading-[1.55]">
                If an account exists for{' '}
                <span className="font-mono text-text">{email}</span>, we sent a password reset link. It expires in 60 minutes.
              </div>
              <div className="text-[12.5px] text-text-muted mt-4">
                <Link href="/login" className="text-text font-medium hover:opacity-80 transition-opacity">
                  ← Back to sign in
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-[22px]">
                <div className="font-mono text-[10.5px] text-accent tracking-[0.06em] uppercase mb-2">Reset password</div>
                <h3 className="text-[26px] font-medium tracking-[-0.7px]">Forgot your password?</h3>
                <div className="text-[13px] text-text-muted mt-1.5">
                  Remembered it?{' '}
                  <Link href="/login" className="text-text font-medium hover:opacity-80 transition-opacity">
                    Sign in →
                  </Link>
                </div>
              </div>

              <form onSubmit={(e) => void handleSubmit(e)}>
                {/* Email field */}
                <div className="mb-[14px]">
                  <label htmlFor="email" className="block font-mono text-[12px] text-text-muted tracking-[0.02em] mb-1.5">Email</label>
                  <div className="flex items-center gap-2 px-3 py-[10px] border border-border-strong rounded-[7px] bg-bg-elev">
                    <span className="font-mono text-[11px] text-text-faint">›</span>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      required
                      className="flex-1 font-mono text-[13px] text-text bg-transparent outline-none placeholder:text-text-faint tracking-[0.01em]"
                    />
                  </div>
                </div>

                {error && <p className="text-[12.5px] text-bad mb-3">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? 'Sending link…' : 'Send reset link'}
                  {!loading && <span className="font-mono text-[11px] opacity-70">↵</span>}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
