'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { GithubIcon, GoogleIcon } from '@/components/ui/provider-icons'

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
    <div className="min-h-screen bg-bg-elev grid grid-cols-2">

      {/* ── Left pane, product proof ─────────────────────────────── */}
      <div className="bg-bg border-r border-border p-10 flex flex-col justify-between">
        <div>
          <LogoMark />
          <div className="mt-12 max-w-[400px]">
            <h2 className="text-[34px] font-medium tracking-[-1px] leading-[1.1] [text-wrap:balance]">
              Every LLM call.<br />
              <span className="text-text-muted">Observed.</span>
            </h2>
            <p className="text-[14px] text-text-muted leading-[1.55] mt-4">
              Sign in to your workspace. SSO is the default; email is a fallback.
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
          <div className="mb-[22px]">
            <div className="font-mono text-[10.5px] text-accent tracking-[0.06em] uppercase mb-2">Welcome back</div>
            <h3 className="text-[26px] font-medium tracking-[-0.7px]">Sign in to Spanlens</h3>
            <div className="text-[13px] text-text-muted mt-1.5">
              No account?{' '}
              <Link href="/signup" className="text-text font-medium hover:opacity-80 transition-opacity">
                Create workspace →
              </Link>
            </div>
          </div>

          {/* SSO buttons */}
          <div className="flex flex-col gap-2 mb-2">
            <button
              type="button"
              onClick={() => void handleOAuth('google')}
              disabled={loading}
              className="flex items-center justify-center gap-2.5 px-[14px] py-[10px] border border-border-strong rounded-[7px] bg-white text-[13px] font-medium text-[#111] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <GoogleIcon className="w-[18px] h-[18px] shrink-0" />
              <span>Continue with Google</span>
            </button>
            <button
              type="button"
              onClick={() => void handleOAuth('github')}
              disabled={loading}
              className="flex items-center justify-center gap-2.5 px-[14px] py-[10px] rounded-[7px] bg-black text-[13px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <GithubIcon className="w-[18px] h-[18px] shrink-0" />
              <span>Continue with GitHub</span>
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
              <div className="flex justify-between mb-1.5">
                <label htmlFor="email" className="font-mono text-[12px] text-text-muted tracking-[0.02em]">Email</label>
              </div>
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

            {/* Password field */}
            <div className="mb-[14px]">
              <div className="flex justify-between mb-1.5">
                <label htmlFor="password" className="font-mono text-[12px] text-text-muted tracking-[0.02em]">Password</label>
                <Link href="/forgot-password" className="font-mono text-[10.5px] text-accent hover:opacity-80 transition-opacity">Forgot?</Link>
              </div>
              <div className="flex items-center gap-2 px-3 py-[10px] border border-border-strong rounded-[7px] bg-bg-elev">
                <span className="font-mono text-[11px] text-text-faint">◉</span>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="flex-1 font-mono text-[13px] text-text bg-transparent outline-none placeholder:text-text-faint"
                />
              </div>
            </div>

            {error && <p className="text-[12.5px] text-bad mb-3">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in…' : 'Sign in'}
              {!loading && <span className="font-mono text-[11px] opacity-70">↵</span>}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
