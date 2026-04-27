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

const DIGIT_COUNT = 6

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

  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <LogoMark />

        <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-2">
          Two-factor authentication
        </h1>
        <p className="font-mono text-[11px] text-text-muted mb-6">
          Enter the 6-digit code from your authenticator app.
        </p>

        {missingParams ? (
          <p className="text-[13px] text-bad">
            Missing authentication parameters. Please restart the sign-in flow.
          </p>
        ) : (
          <>
            {/* OTP input grid */}
            <div className="flex gap-2 mb-5 justify-center" onPaste={handlePaste}>
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleChange(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  disabled={verifying}
                  className="w-12 h-12 text-center text-[18px] font-mono text-text border border-border-strong rounded-[7px] bg-bg-elev outline-none focus:border-accent transition-colors disabled:opacity-40"
                  aria-label={`Digit ${i + 1}`}
                />
              ))}
            </div>

            {error && <p className="text-[12.5px] text-bad mb-3 text-center">{error}</p>}

            {verifying && (
              <p className="text-[12.5px] text-text-muted mb-3 text-center">Verifying…</p>
            )}

            {/* Remember device */}
            <label className="flex items-center gap-2.5 cursor-pointer mb-5">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="w-4 h-4 rounded accent-accent cursor-pointer"
              />
              <span className="text-[13px] text-text-muted">Remember this device for 30 days</span>
            </label>
          </>
        )}

        <div className="text-center">
          <Link
            href="#"
            className="font-mono text-[12px] text-text-faint hover:text-text transition-colors"
          >
            Use a recovery code instead →
          </Link>
        </div>
      </div>
    </div>
  )
}

function MfaFallback() {
  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <div className="text-[13px] text-text-muted">Loading…</div>
      </div>
    </div>
  )
}

export default function MfaPage() {
  return (
    <Suspense fallback={<MfaFallback />}>
      <MfaPageInner />
    </Suspense>
  )
}
