'use client'
import { Suspense, useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
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
    <main className="min-h-screen bg-bg flex items-center justify-center px-6 py-10">
      <div className="text-[13px] text-text-muted">Loading…</div>
    </main>
  )
}

function SignupPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const inviteToken = params.get('invite')
  const prefillEmail = params.get('email') ?? ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  // Prefill email from invitation link — the server issues invitations bound
  // to a specific email, so typing a different one would just fail on accept.
  useEffect(() => {
    if (prefillEmail && !email) setEmail(prefillEmail)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillEmail])

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
        router.push('/dashboard')
        return
      }
      // Fall through: account was created but accept failed. Send them to
      // /invite which will show the error clearly with options.
      router.push(`/invite?token=${encodeURIComponent(inviteToken)}`)
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

  return (
    <div className="min-h-screen bg-bg-elev grid grid-cols-2">

      {/* ── Left pane — product proof ─────────────────────────────── */}
      <div className="bg-bg border-r border-border p-10 flex flex-col justify-between">
        <div>
          <LogoMark />
          <div className="mt-12 max-w-[400px]">
            <h2 className="text-[34px] font-medium tracking-[-1px] leading-[1.1] [text-wrap:balance]">
              Your first{' '}
              <span className="text-text-muted">50,000 requests</span>{' '}
              are on us.
            </h2>
            <p className="text-[14px] text-text-muted leading-[1.55] mt-4">
              No credit card. Self-host forever-free. Cancel anytime — there is nothing to cancel.
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

      {/* ── Right pane — form ────────────────────────────────────────── */}
      <div className="flex items-center justify-center p-10">
        <div className="w-[360px] max-w-full">
          {sent ? (
            <div className="text-center">
              <div className="w-9 h-9 rounded-full bg-accent-bg border border-accent-border flex items-center justify-center mx-auto mb-3 font-mono text-[14px] text-accent">✉</div>
              <div className="text-[16px] font-medium tracking-[-0.2px] mb-1.5">Check your inbox.</div>
              <div className="text-[12.5px] text-text-muted leading-[1.55]">
                We sent a sign-in link to{' '}
                <span className="font-mono text-text">{email}</span>. It expires in 10 minutes.
              </div>
            </div>
          ) : (
            <>
              <div className="mb-[22px]">
                <div className="font-mono text-[10.5px] text-accent tracking-[0.06em] uppercase mb-2">60 seconds</div>
                <h3 className="text-[26px] font-medium tracking-[-0.7px]">Create your workspace</h3>
                <div className="text-[13px] text-text-muted mt-1.5">
                  Have an account?{' '}
                  <Link href="/login" className="text-text font-medium hover:opacity-80 transition-opacity">
                    Sign in →
                  </Link>
                </div>
              </div>

              {/* SSO buttons */}
              <div className="flex flex-col gap-2 mb-2">
                <button
                  type="button"
                  className="flex items-center gap-2.5 px-[14px] py-[10px] border border-border-strong rounded-[7px] bg-bg text-[13px] text-text hover:opacity-80 transition-opacity"
                >
                  <span className="w-[18px] h-[18px] rounded-[4px] bg-bg-muted flex items-center justify-center font-mono text-[10px] text-text-muted font-bold">G</span>
                  <span className="flex-1 text-left">Continue with Google</span>
                  <span className="font-mono text-[10px] text-text-faint tracking-[0.03em]">recommended</span>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2.5 px-[14px] py-[10px] border border-border-strong rounded-[7px] bg-bg text-[13px] text-text hover:opacity-80 transition-opacity"
                >
                  <span className="w-[18px] h-[18px] rounded-[4px] bg-bg-muted flex items-center justify-center font-mono text-[10px] text-text-muted font-bold">⌥</span>
                  <span className="flex-1 text-left">Continue with GitHub</span>
                </button>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-2.5 my-4">
                <span className="flex-1 h-px bg-border" />
                <span className="font-mono text-[10px] text-text-faint tracking-[0.05em] uppercase">or with email</span>
                <span className="flex-1 h-px bg-border" />
              </div>

              <form onSubmit={(e) => void handleSubmit(e)}>
                {/* Email field */}
                <div className="mb-[14px]">
                  <label htmlFor="email" className="block font-mono text-[12px] text-text-muted tracking-[0.02em] mb-1.5">Work email</label>
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
                  <div className="font-mono text-[10.5px] text-text-faint mt-1.5 tracking-[0.02em]">We&apos;ll send a verification link.</div>
                </div>

                {/* Password field */}
                <div className="mb-[14px]">
                  <label htmlFor="password" className="block font-mono text-[12px] text-text-muted tracking-[0.02em] mb-1.5">Password</label>
                  <div className="flex items-center gap-2 px-3 py-[10px] border border-border-strong rounded-[7px] bg-bg-elev">
                    <span className="font-mono text-[11px] text-text-faint">◉</span>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      minLength={8}
                      required
                      className="flex-1 font-mono text-[13px] text-text bg-transparent outline-none placeholder:text-text-faint"
                    />
                  </div>
                </div>

                {/* Terms checkbox */}
                <label className="flex gap-2.5 mb-4 cursor-pointer items-start">
                  <span
                    className="w-[14px] h-[14px] rounded-[3px] border-[1.5px] shrink-0 mt-[2px] flex items-center justify-center font-mono text-[9px]"
                    style={{
                      borderColor: 'var(--border-strong)',
                      background: consent ? 'var(--text)' : 'transparent',
                      color: 'var(--bg)',
                    }}
                  >
                    {consent ? '✓' : ''}
                  </span>
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="sr-only"
                  />
                  <span className="text-[12px] text-text-muted leading-relaxed">
                    I agree to the{' '}
                    <Link href="/terms" target="_blank" className="text-text hover:opacity-80 transition-opacity">Terms</Link>
                    {' '}and{' '}
                    <Link href="/privacy" target="_blank" className="text-text hover:opacity-80 transition-opacity">Privacy Policy</Link>.
                  </span>
                </label>

                {error && <p className="text-[12.5px] text-bad mb-3">{error}</p>}

                <button
                  type="submit"
                  disabled={loading || !consent}
                  className="w-full bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating workspace…' : 'Create workspace →'}
                </button>
              </form>

              <div className="mt-[18px] font-mono text-[10.5px] text-text-faint leading-[1.6]">
                Included · 50k requests / mo · 7d retention · unlimited projects
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
