'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LogoMark() {
  return (
    <div className="flex items-center gap-2 mb-6">
      <svg width="17" height="17" viewBox="0 0 20 20" className="shrink-0">
        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--text)" strokeWidth="1.5" />
        <circle cx="10" cy="10" r="3.5" fill="var(--accent)" />
      </svg>
      <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
    </div>
  )
}

const COUNTDOWN_START = 42

function VerifyEmailInner() {
  const params = useSearchParams()
  const email = params.get('email') ?? ''

  const [countdown, setCountdown] = useState(COUNTDOWN_START)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  async function handleResend() {
    if (countdown > 0 || sending) return
    if (!email) {
      setError('No email address found. Please go back and try again.')
      return
    }

    setSending(true)
    setError('')
    setSent(false)

    const supabase = createClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({ email })

    setSending(false)

    if (otpError) {
      setError(otpError.message)
      return
    }

    setSent(true)
    setCountdown(COUNTDOWN_START)

    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current)
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const displayEmail = email || 'your email address'

  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <LogoMark />

        <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-2">Check your inbox</h1>
        <p className="text-[13px] text-text-muted leading-relaxed mb-6">
          We sent a magic link to{' '}
          <span className="font-mono text-text">{displayEmail}</span>. It expires in 10 minutes.
        </p>

        {sent && (
          <p className="text-[12.5px] text-accent mb-3">Magic link resent successfully.</p>
        )}
        {error && <p className="text-[12.5px] text-bad mb-3">{error}</p>}

        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={countdown > 0 || sending}
          className="w-full bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
        >
          {sending
            ? 'Sending…'
            : countdown > 0
              ? `Resend in ${countdown}s`
              : 'Resend email'}
        </button>

        <div className="mt-5 text-center">
          <Link
            href="/login"
            className="font-mono text-[12px] text-text-faint hover:text-text transition-colors"
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

function VerifyEmailFallback() {
  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <div className="text-[13px] text-text-muted">Loading…</div>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailInner />
    </Suspense>
  )
}
