'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  AuthFootnote,
  AuthHeading,
  AuthLayout,
  AuthNote,
  authLink,
  authPrimaryButton,
} from '../_components/auth-shell'

const DIGIT_COUNT = 6

const PITCH = {
  title: 'Second factor, every sign in.',
  body: 'Codes come from your authenticator app. Recovery codes work once each if you lose the device.',
}

function MfaPageInner() {
  const params = useSearchParams()
  const factorId = params.get('factor_id') ?? ''
  const challengeId = params.get('challenge_id') ?? ''

  const [digits, setDigits] = useState<string[]>(Array(DIGIT_COUNT).fill(''))
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [rememberDevice, setRememberDevice] = useState(false)
  const inputRefs = useRef<Array<HTMLInputElement | null>>(Array(DIGIT_COUNT).fill(null))

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  async function submitCode(code: string) {
    if (!factorId || !challengeId) {
      setError('Missing factor or challenge ID. Please restart the sign-in flow.')
      return
    }

    setVerifying(true)
    setError('')

    const supabase = createClient()
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    })

    setVerifying(false)

    if (verifyError) {
      setError('Invalid code. Try again.')
      setDigits(Array(DIGIT_COUNT).fill(''))
      inputRefs.current[0]?.focus()
      return
    }

    // Use hard navigation (not router.push) so the dashboard layout
    // re-evaluates middleware-derived headers fresh — see CLAUDE.md gotcha #15.
    // eslint-disable-next-line react-hooks/immutability -- intentional hard nav after async submit
    window.location.href = '/dashboard'
  }

  function handleChange(index: number, value: string) {
    const cleaned = value.replace(/\D/g, '').slice(0, 1)
    const next = digits.map((d, i) => (i === index ? cleaned : d))
    setDigits(next)

    if (cleaned && index < DIGIT_COUNT - 1) {
      inputRefs.current[index + 1]?.focus()
    }

    const full = next.join('')
    if (full.length === DIGIT_COUNT && next.every((d) => d !== '')) {
      void submitCode(full)
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const next = digits.map((d, i) => (i === index ? '' : d))
        setDigits(next)
      } else if (index > 0) {
        const next = digits.map((d, i) => (i === index - 1 ? '' : d))
        setDigits(next)
        inputRefs.current[index - 1]?.focus()
      }
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, DIGIT_COUNT)
    if (!pasted) return

    const next = Array(DIGIT_COUNT)
      .fill('')
      .map((_, i) => pasted[i] ?? '')
    setDigits(next)

    const focusIndex = Math.min(pasted.length, DIGIT_COUNT - 1)
    inputRefs.current[focusIndex]?.focus()

    if (pasted.length === DIGIT_COUNT) {
      void submitCode(pasted)
    }
  }

  const missingParams = !factorId || !challengeId
  const code = digits.join('')

  if (missingParams) {
    return (
      <AuthLayout pitch={PITCH}>
        <AuthHeading
          title="We lost the challenge"
          subtitle="This page needs the factor and challenge issued at sign in."
        />
        <AuthNote tone="bad">Restart the sign-in flow and enter your code there.</AuthNote>
        <AuthFootnote className="mt-[18px]">
          <Link href="/login" className={authLink}>
            Back to sign in
          </Link>
        </AuthFootnote>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout pitch={PITCH}>
      <AuthHeading title="Enter your code" subtitle="Six digits from your authenticator app." />

      {/* The board draws six separate boxes, so each digit is its own input.
          `fieldset` + `legend` gives the group one accessible name; the
          per-box aria-labels keep each cell identifiable on its own. */}
      {/* `min-w-0` is load-bearing: a fieldset defaults to min-inline-size
          min-content, so without it the six inputs refuse to shrink and the
          row overflows the 400px column. */}
      <fieldset className="m-0 w-full min-w-0 border-0 p-0">
        <legend className="sr-only">Six digit authentication code</legend>
        <div className="flex gap-2.5" onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el }}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? 'one-time-code' : 'off'}
              maxLength={1}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={verifying}
              aria-label={`Digit ${i + 1}`}
              aria-invalid={error ? true : undefined}
              className="h-[62px] min-w-0 flex-1 rounded-lg border border-border bg-bg-elev text-center font-mono text-[20px] text-text transition-colors focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 aria-[invalid=true]:border-bad"
            />
          ))}
        </div>
      </fieldset>

      {error && <AuthNote tone="bad" live="assertive" className="mt-4">{error}</AuthNote>}
      {verifying && <AuthNote live="polite" className="mt-4">Verifying…</AuthNote>}

      <label className="mt-4 flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={rememberDevice}
          onChange={(e) => setRememberDevice(e.target.checked)}
          className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
        />
        <span className="text-[12.5px] leading-[1.48] text-text-muted">Remember this device for 30 days</span>
      </label>

      {/* The six boxes auto-submit on the last digit; this button is the
          explicit path for anyone who tabs away before that fires. */}
      <button
        type="button"
        onClick={() => void submitCode(code)}
        disabled={verifying || code.length < DIGIT_COUNT}
        className={`${authPrimaryButton} mt-[22px]`}
      >
        {verifying ? 'Verifying…' : 'Verify and continue'}
      </button>

      <AuthFootnote className="mt-[18px]">
        Lost the device?{' '}
        <Link href="/login" className={authLink}>
          Use a recovery code
        </Link>
      </AuthFootnote>
    </AuthLayout>
  )
}

function MfaFallback() {
  return (
    <AuthLayout pitch={PITCH}>
      <p className="text-[13.5px] leading-[1.6] text-text-faint" role="status">
        Loading…
      </p>
    </AuthLayout>
  )
}

export default function MfaPage() {
  return (
    <Suspense fallback={<MfaFallback />}>
      <MfaPageInner />
    </Suspense>
  )
}
