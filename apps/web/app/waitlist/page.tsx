'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'

const LAUNCH_DATE = new Date('2026-06-03T00:00:00+09:00') // KST midnight
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://spanlens-server.vercel.app'

function LogoMark() {
  return (
    <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
      <img src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" />
      <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
    </Link>
  )
}

function useCountdown(target: Date) {
  const calc = () => {
    const diff = Math.max(0, target.getTime() - Date.now())
    return {
      days:    Math.floor(diff / 86400000),
      hours:   Math.floor((diff % 86400000) / 3600000),
      minutes: Math.floor((diff % 3600000) / 60000),
      seconds: Math.floor((diff % 60000) / 1000),
    }
  }
  const [t, setT] = useState(calc)
  useEffect(() => {
    const id = setInterval(() => setT(calc()), 1000)
    return () => clearInterval(id)
  }, [])
  return t
}

function Pad({ n }: { n: number }) {
  return <>{String(n).padStart(2, '0')}</>
}

export default function WaitlistPage() {
  const { days, hours, minutes, seconds } = useCountdown(LAUNCH_DATE)
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setState('loading')
    try {
      const res = await fetch(`${API_BASE}/api/v1/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const json = await res.json() as { success?: boolean; alreadyRegistered?: boolean; error?: string }
      if (res.ok && json.success) {
        setState('success')
        setMessage(json.alreadyRegistered
          ? "You're already on the list — we'll reach out before launch."
          : "You're on the list! We'll send you early access on June 3.")
      } else {
        setState('error')
        setMessage(json.error ?? 'Something went wrong. Please try again.')
      }
    } catch {
      setState('error')
      setMessage('Network error. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-bg-elev grid grid-cols-1 md:grid-cols-2">

      {/* ── Left pane ─────────────────────────────────────────────── */}
      <div className="bg-bg border-b md:border-b-0 md:border-r border-border p-8 md:p-10 flex flex-col justify-between gap-10">
        <LogoMark />

        <div className="max-w-[400px]">
          {/* Launch badge */}
          <div className="inline-flex items-center gap-2 px-[10px] py-[5px] rounded-full border border-accent/30 bg-accent/8 text-accent font-mono text-[11px] tracking-[0.04em] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block animate-pulse" />
            Launching June 3, 2026
          </div>

          <h2 className="text-[32px] md:text-[38px] font-medium tracking-[-1.2px] leading-[1.08] mb-4 [text-wrap:balance]">
            LLM observability.<br />
            <span className="text-text-muted">One line of code.</span>
          </h2>
          <p className="text-[14px] text-text-muted leading-[1.6] mb-8">
            Record every OpenAI, Anthropic, and Gemini call — cost, latency,
            tokens, full request/response. Anomaly detection, PII scanning,
            and model-swap recommendations included.
          </p>

          {/* Countdown */}
          <div className="flex items-end gap-4 mb-8">
            {[
              { v: days,    l: 'days' },
              { v: hours,   l: 'hrs' },
              { v: minutes, l: 'min' },
              { v: seconds, l: 'sec' },
            ].map(({ v, l }) => (
              <div key={l} className="flex flex-col items-center gap-0.5">
                <span className="font-mono text-[32px] md:text-[36px] font-medium leading-none tracking-[-1px] text-text tabular-nums">
                  <Pad n={v} />
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.07em] text-text-faint">{l}</span>
              </div>
            ))}
          </div>

          {/* Product bullets */}
          <div className="flex flex-col gap-[7px]">
            {[
              'Drop-in replacement for OpenAI / Anthropic / Gemini SDKs',
              'Full request + response body, tokens, cost, latency — every call',
              'Agent span waterfall, anomaly detection, PII masking',
              'MIT licensed · self-hostable',
            ].map((b) => (
              <div key={b} className="flex items-start gap-2 font-mono text-[12px] text-text-muted">
                <span className="text-accent mt-px shrink-0">·</span>
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="font-mono text-[11px] text-text-faint">
          Want to explore first?{' '}
          <Link href="/demo/dashboard" className="text-accent hover:opacity-80 transition-opacity">
            Try the live demo →
          </Link>
        </div>
      </div>

      {/* ── Right pane ────────────────────────────────────────────── */}
      <div className="flex items-center justify-center p-8 md:p-10">
        <div className="w-full max-w-[360px]">
          <div className="mb-7">
            <div className="font-mono text-[10.5px] text-accent tracking-[0.06em] uppercase mb-2">Early access</div>
            <h3 className="text-[26px] font-medium tracking-[-0.7px] mb-2">Get notified at launch</h3>
            <p className="text-[13px] text-text-muted leading-[1.55]">
              Leave your email and we&apos;ll send you early access the moment
              we go live on June 3rd — no spam, one email.
            </p>
          </div>

          {state === 'success' ? (
            <div className="flex flex-col items-start gap-4">
              <div className="flex items-center gap-2.5 px-4 py-3 rounded-[8px] bg-accent/8 border border-accent/20 text-accent font-mono text-[13px] w-full">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
                  <path d="M2 7l3.5 3.5L12 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {message}
              </div>
              <p className="text-[12.5px] text-text-faint font-mono">
                In the meantime,{' '}
                <Link href="/demo/dashboard" className="text-accent hover:opacity-80 transition-opacity">
                  explore the live demo →
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
              <div className="flex items-center gap-2 px-3 py-[10px] border border-border-strong rounded-[7px] bg-bg">
                <span className="font-mono text-[11px] text-text-faint">›</span>
                <input
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={state === 'loading'}
                  className="flex-1 font-mono text-[13px] text-text bg-transparent outline-none placeholder:text-text-faint tracking-[0.01em] disabled:opacity-50"
                />
              </div>

              {state === 'error' && (
                <p className="font-mono text-[12px] text-bad">{message}</p>
              )}

              <button
                type="submit"
                disabled={state === 'loading' || !email.trim()}
                className="w-full bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {state === 'loading' ? 'Joining…' : 'Join the waitlist →'}
              </button>

              <p className="font-mono text-[10.5px] text-text-faint text-center">
                No credit card · no spam · one email on launch day
              </p>
            </form>
          )}

          <div className="mt-10 pt-6 border-t border-border">
            <p className="font-mono text-[11px] text-text-faint text-center">
              Already have an account?{' '}
              <Link href="/login?direct=1" className="text-text hover:opacity-80 transition-opacity">
                Sign in directly
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
