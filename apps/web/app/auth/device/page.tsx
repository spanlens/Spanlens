'use client'

import { Suspense, useState } from 'react'
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

type DeviceState = 'idle' | 'authorizing' | 'authorized' | 'denied' | 'error'

const PITCH = {
  title: 'Approve the CLI once.',
  body: 'The code below is tied to the terminal that asked for it. Nothing else can claim it.',
}

function DevicePageInner() {
  const params = useSearchParams()
  const code = params.get('code') ?? ''
  const tool = params.get('tool') ?? ''
  const ip = params.get('ip') ?? ''

  const [state, setState] = useState<DeviceState>('idle')
  const [error, setError] = useState('')

  async function handleAuthorize() {
    if (!code) return
    setState('authorizing')
    setError('')

    try {
      const res = await fetch('/api/v1/auth/device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Authorization failed. Please try again.')
        setState('error')
        return
      }

      setState('authorized')
    } catch {
      setError('Network error. Please try again.')
      setState('error')
    }
  }

  function handleDeny() {
    setState('denied')
  }

  if (!code) {
    return (
      <AuthLayout pitch={PITCH}>
        <AuthHeading
          title="No device code found"
          subtitle="Run the CLI login command to generate one, then open the link it prints."
        />
        <AuthNote tone="bad">This page needs a code in the URL to have anything to approve.</AuthNote>
      </AuthLayout>
    )
  }

  if (state === 'authorized') {
    return (
      <AuthLayout pitch={PITCH}>
        <AuthHeading title="Device authorized" subtitle="You can close this window and return to your terminal." />
        <AuthNote tone="good" live="polite">
          The CLI has been granted access.
        </AuthNote>
      </AuthLayout>
    )
  }

  if (state === 'denied') {
    return (
      <AuthLayout pitch={PITCH}>
        <AuthHeading title="Access denied" subtitle="Nothing was granted. You can close this window." />
        <AuthNote live="polite">If that was a mistake, run the CLI login command again.</AuthNote>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout pitch={PITCH}>
      <AuthHeading
        title="Authorize this device"
        subtitle={
          tool || ip ? (
            <>
              {tool && <span className="font-mono text-text">{tool}</span>}
              {tool && ip && ' from '}
              {ip && <span className="font-mono text-text">{ip}</span>}
              {' wants access to your workspace.'}
            </>
          ) : (
            'A command line tool wants access to your workspace.'
          )
        }
      />

      {/* The code is the whole security story here, so it gets the display
          treatment: sunk panel, wide tracking, nothing competing with it. */}
      <div className="rounded-[14px] border border-border bg-bg-sunk px-6 py-[22px] text-center">
        <span className="font-mono text-[26px] leading-[1.48] tracking-[0.06em] text-text">{code}</span>
      </div>

      <AuthNote tone="warn" className="mt-3.5">
        Only approve if this code matches the one printed in your terminal.
      </AuthNote>

      {error && <AuthNote tone="bad" live="assertive" className="mt-2.5">{error}</AuthNote>}

      <div className="mt-5 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => void handleAuthorize()}
          disabled={state === 'authorizing'}
          className={authPrimaryButton}
        >
          {state === 'authorizing' ? 'Authorizing…' : 'Approve device'}
        </button>
        <button
          type="button"
          onClick={handleDeny}
          disabled={state === 'authorizing'}
          className={authSecondaryButton}
        >
          Reject
        </button>
      </div>

      <AuthFootnote className="mt-[18px]">
        Did not start this?{' '}
        <Link href="/login" className={authLink}>
          Sign in and review your sessions
        </Link>
      </AuthFootnote>
    </AuthLayout>
  )
}

function DeviceFallback() {
  return (
    <AuthLayout pitch={PITCH}>
      <p className="text-[13.5px] leading-[1.6] text-text-faint" role="status">
        Loading…
      </p>
    </AuthLayout>
  )
}

export default function DevicePage() {
  return (
    <Suspense fallback={<DeviceFallback />}>
      <DevicePageInner />
    </Suspense>
  )
}
