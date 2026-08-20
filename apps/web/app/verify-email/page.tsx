'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  AuthHeading,
  AuthLayout,
  AuthNote,
  authPrimaryButton,
  authSecondaryButton,
} from '../auth/_components/auth-shell'

const COUNTDOWN_START = 42

const PITCH = {
  title: 'One click and you are in.',
  body: 'Verifying the address keeps invite links and billing receipts pointed at a mailbox you own.',
}

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
    // Resend the signup confirmation email (not a fresh magic link). The
    // user already created an account with a password; `resend` reissues
    // the original confirmation link, which lands on /auth/callback and
    // completes sign-in. `emailRedirectTo` must match the signup call so
    // the callback receives the code on the same route.
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    setSending(false)

    if (resendError) {
      setError(resendError.message)
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

  return (
    <AuthLayout pitch={PITCH}>
      <AuthHeading
        title="Check your inbox"
        subtitle={
          email ? (
            <>
              We sent a verification link to <span className="font-mono text-text">{email}</span>. Open it to
              activate your account.
            </>
          ) : (
            'We sent a verification link to the address you signed up with. Open it to activate your account.'
          )
        }
      />

      <AuthNote>Nothing yet? Check spam, then resend.</AuthNote>

      {sent && (
        <AuthNote tone="good" live="polite" className="mt-2.5">
          Confirmation email resent.
        </AuthNote>
      )}
      {error && (
        <AuthNote tone="bad" live="assertive" className="mt-2.5">
          {error}
        </AuthNote>
      )}

      <div className="mt-[18px] flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={countdown > 0 || sending}
          className={authPrimaryButton}
        >
          {sending ? 'Sending…' : countdown > 0 ? `Resend in ${countdown}s` : 'Resend the link'}
        </button>
        {/* The board labels this "Use a different email". It points at sign-in
            here because that is where the existing flow sends people, and the
            destination is not ours to change. */}
        <Link href="/login" className={authSecondaryButton}>
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  )
}

function VerifyEmailFallback() {
  return (
    <AuthLayout pitch={PITCH}>
      <p className="text-[13.5px] leading-[1.6] text-text-faint" role="status">
        Loading…
      </p>
    </AuthLayout>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailInner />
    </Suspense>
  )
}
