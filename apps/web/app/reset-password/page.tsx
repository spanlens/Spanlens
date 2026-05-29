'use client'
import { useEffect, useState } from 'react'
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

type SessionState = 'checking' | 'ready' | 'missing'

export default function ResetPasswordPage() {
  // The recovery session is established by /auth/callback before it forwards
  // here. We confirm it exists on mount so we can show a clear "link expired"
  // message instead of letting updateUser() fail with a cryptic error.
  const [sessionState, setSessionState] = useState<SessionState>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      setSessionState(data.session ? 'ready' : 'missing')
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.updateUser({ password })
    if (authError) {
      setError(authError.message)
      setLoading(false)
      return
    }
    // Hard navigation so middleware re-evaluates the (now updated) session and
    // routes to /onboarding vs /dashboard correctly. See gotcha #15 — a
    // client-side router.push keeps a stale RSC tree.
    window.location.href = '/dashboard'
  }

  return (
    <div className="min-h-screen bg-bg-elev grid grid-cols-2">

      {/* ── Left pane, product proof ─────────────────────────────── */}
      <div className="bg-bg border-r border-border p-10 flex flex-col justify-between">
        <div>
          <LogoMark />
          <div className="mt-12 max-w-[400px]">
            <h2 className="text-[34px] font-medium tracking-[-1px] leading-[1.1] [text-wrap:balance]">
              Set a new password.<br />
              <span className="text-text-muted">You&apos;re almost in.</span>
            </h2>
            <p className="text-[14px] text-text-muted leading-[1.55] mt-4">
              Choose a strong password. You&apos;ll be signed in right after.
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
          {sessionState === 'checking' ? (
            <div className="text-[13px] text-text-muted">Verifying reset link…</div>
          ) : sessionState === 'missing' ? (
            <div className="text-center">
              <div className="w-9 h-9 rounded-full bg-bad-bg border border-border-strong flex items-center justify-center mx-auto mb-3 font-mono text-[14px] text-bad">✕</div>
              <div className="text-[16px] font-medium tracking-[-0.2px] mb-1.5">Link invalid or expired.</div>
              <div className="text-[12.5px] text-text-muted leading-[1.55]">
                Reset links expire after 60 minutes and can only be used once.
              </div>
              <div className="text-[12.5px] text-text-muted mt-4">
                <Link href="/forgot-password" className="text-text font-medium hover:opacity-80 transition-opacity">
                  Request a new link →
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-[22px]">
                <div className="font-mono text-[10.5px] text-accent tracking-[0.06em] uppercase mb-2">Reset password</div>
                <h3 className="text-[26px] font-medium tracking-[-0.7px]">Choose a new password</h3>
              </div>

              <form onSubmit={(e) => void handleSubmit(e)}>
                {/* New password field */}
                <div className="mb-[14px]">
                  <label htmlFor="password" className="block font-mono text-[12px] text-text-muted tracking-[0.02em] mb-1.5">New password</label>
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

                {/* Confirm password field */}
                <div className="mb-[14px]">
                  <label htmlFor="confirm" className="block font-mono text-[12px] text-text-muted tracking-[0.02em] mb-1.5">Confirm password</label>
                  <div className="flex items-center gap-2 px-3 py-[10px] border border-border-strong rounded-[7px] bg-bg-elev">
                    <span className="font-mono text-[11px] text-text-faint">◉</span>
                    <input
                      id="confirm"
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="Re-enter password"
                      minLength={8}
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
                  {loading ? 'Updating…' : 'Update password'}
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
