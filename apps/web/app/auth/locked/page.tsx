'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { LockIcon } from 'lucide-react'

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

function formatMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function LockedPageInner() {
  const params = useSearchParams()
  const untilParam = params.get('until') ?? ''

  const [remaining, setRemaining] = useState<number | null>(() => {
    if (!untilParam) return null
    const diff = Math.max(0, Math.floor((new Date(untilParam).getTime() - Date.now()) / 1000))
    return diff
  })

  useEffect(() => {
    if (remaining === null) return
    if (remaining <= 0) return

    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [remaining])

  const isUnlocked = remaining !== null && remaining === 0

  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <LogoMark />

        {/* Lock icon */}
        <div className="flex justify-center mb-4">
          <LockIcon className="w-10 h-10 text-text-muted" />
        </div>

        <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-2 text-center">
          Account temporarily locked
        </h1>

        <p className="text-[13px] text-text-muted leading-relaxed mb-5 text-center">
          Too many failed sign-in attempts. Your account has been locked for 15 minutes.
        </p>

        {/* Countdown or static message */}
        {remaining !== null ? (
          <div className="bg-bg-elev border border-border rounded-[8px] px-5 py-4 mb-6 text-center">
            {isUnlocked ? (
              <p className="text-[13px] text-text-muted mb-3">Your account has been unlocked.</p>
            ) : (
              <>
                <p className="font-mono text-[11px] text-text-faint mb-1 tracking-[0.04em] uppercase">
                  Unlocks in
                </p>
                <span className="font-mono text-[32px] text-text tracking-[0.05em]">
                  {formatMMSS(remaining)}
                </span>
              </>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-text-muted mb-6 text-center">
            Please try again in 15 minutes.
          </p>
        )}

        {isUnlocked && (
          <Link
            href="/login"
            className="block w-full bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium text-center hover:opacity-90 transition-opacity mb-3"
          >
            Sign in now →
          </Link>
        )}

        <Link
          href="/login"
          className="block w-full border border-border-strong py-[11px] px-[14px] rounded-[7px] text-[13px] text-text-muted text-center hover:text-text transition-colors"
        >
          Get a magic link instead →
        </Link>
      </div>
    </div>
  )
}

function LockedFallback() {
  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <div className="text-[13px] text-text-muted">Loading…</div>
      </div>
    </div>
  )
}

export default function LockedPage() {
  return (
    <Suspense fallback={<LockedFallback />}>
      <LockedPageInner />
    </Suspense>
  )
}
