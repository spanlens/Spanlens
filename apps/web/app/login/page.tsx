'use client'
import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-bg-elev grid grid-cols-2">

      {/* ── Left pane — product proof ─────────────────────────────── */}
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

      {/* ── Right pane — form ────────────────────────────────────────── */}
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
              className="flex items-center gap-2.5 px-[14px] py-[10px] border border-border-strong rounded-[7px] bg-bg text-[13px] text-text hover:opacity-80 transition-opacity"
            >
              <span className="w-[18px] h-[18px] rounded-[4px] bg-bg-muted flex items-center justify-center font-mono text-[10px] text-text-muted font-bold">G</span>
              <span className="flex-1 text-left">Continue with Google</span>
              <span className="font-mono text-[10px] text-text-faint tracking-[0.03em]">sso · oauth</span>
            </button>
            <button
              type="button"
              className="flex items-center gap-2.5 px-[14px] py-[10px] border border-border-strong rounded-[7px] bg-bg text-[13px] text-text hover:opacity-80 transition-opacity"
            >
              <span className="w-[18px] h-[18px] rounded-[4px] bg-bg-muted flex items-center justify-center font-mono text-[10px] text-text-muted font-bold">⌥</span>
              <span className="flex-1 text-left">Continue with GitHub</span>
              <span className="font-mono text-[10px] text-text-faint tracking-[0.03em]">sso · oauth</span>
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
                <Link href="#" className="font-mono text-[10.5px] text-accent">Forgot?</Link>
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

          <div className="mt-[18px] flex justify-between font-mono text-[10.5px] text-text-faint tracking-[0.02em]">
            <span>🔒 TLS 1.3 · SOC 2 Type II</span>
            <span>spanlens.io/security</span>
          </div>
        </div>
      </div>
    </div>
  )
}
