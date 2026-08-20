'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  AuthFootnote,
  AuthHeading,
  AuthLayout,
  AuthNote,
  authLink,
  authPrimaryButton,
  authSecondaryButton,
} from '../_components/auth-shell'

const PITCH = {
  title: 'Too many attempts.',
  body: 'Repeated failures lock the account for 15 minutes. Sessions already signed in keep working.',
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
    <AuthLayout pitch={PITCH}>
      <AuthHeading
        title="Account temporarily locked"
        subtitle="Too many failed sign-in attempts in a row."
      />

      {isUnlocked ? (
        <AuthNote tone="good" live="polite">
          The lock has lifted. You can sign in again.
        </AuthNote>
      ) : remaining !== null ? (
        <AuthNote tone="bad">
          Unlocks automatically in <span className="font-mono tabular-nums">{formatMMSS(remaining)}</span>.
        </AuthNote>
      ) : (
        <AuthNote tone="bad">Unlocks automatically after 15 minutes.</AuthNote>
      )}

      <div className="mt-5 flex flex-col gap-2.5">
        {isUnlocked && (
          <Link href="/login" className={authPrimaryButton}>
            Sign in now
          </Link>
        )}
        <Link href="/login" className={isUnlocked ? authSecondaryButton : authPrimaryButton}>
          Back to sign in
        </Link>
      </div>

      <AuthFootnote className="mt-[18px]">
        Not sure it was you?{' '}
        <Link href="/forgot-password" className={authLink}>
          Reset your password
        </Link>
      </AuthFootnote>
    </AuthLayout>
  )
}

function LockedFallback() {
  return (
    <AuthLayout pitch={PITCH}>
      <p className="text-[13.5px] leading-[1.6] text-text-faint" role="status">
        Loading…
      </p>
    </AuthLayout>
  )
}

export default function LockedPage() {
  return (
    <Suspense fallback={<LockedFallback />}>
      <LockedPageInner />
    </Suspense>
  )
}
