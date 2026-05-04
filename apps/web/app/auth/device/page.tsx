'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function LogoMark() {
  return (
    <div className="flex items-center gap-2 mb-6">
      <img src="/icon.png" alt="Spanlens" width={20} height={20} className="shrink-0 rounded-[5px]" />
      <span className="font-semibold text-[15px] tracking-[-0.3px] text-text">spanlens</span>
    </div>
  )
}

type DeviceState = 'idle' | 'authorizing' | 'authorized' | 'denied' | 'error'

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
      <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
        <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
          <LogoMark />
          <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-2">No device code found</h1>
          <p className="text-[13px] text-text-muted leading-relaxed">
            Please run the CLI login command to generate a device code.
          </p>
        </div>
      </div>
    )
  }

  if (state === 'authorized') {
    return (
      <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
        <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
          <LogoMark />
          <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-2">Device authorized</h1>
          <p className="text-[13px] text-text-muted leading-relaxed">
            You can close this window and return to your terminal.
          </p>
        </div>
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
        <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
          <LogoMark />
          <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-2">Access denied</h1>
          <p className="text-[13px] text-text-muted leading-relaxed">
            You have denied CLI access. You can close this window.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <LogoMark />

        <h1 className="text-[20px] font-medium tracking-[-0.3px] mb-5">Authorize CLI access</h1>

        {/* Code display */}
        <div className="mb-5">
          <p className="font-mono text-[11px] text-text-faint mb-2 tracking-[0.04em] uppercase">
            Your device code
          </p>
          <div className="bg-bg-muted rounded-[8px] px-6 py-4 inline-block">
            <span className="font-mono text-[32px] tracking-[0.15em] text-text">{code}</span>
          </div>
        </div>

        {/* Tool / IP metadata */}
        {(tool || ip) && (
          <div className="flex flex-col gap-1 mb-5">
            {tool && (
              <div className="font-mono text-[12px] text-text-faint">
                <span className="text-text-muted">Tool:</span> {tool}
              </div>
            )}
            {ip && (
              <div className="font-mono text-[12px] text-text-faint">
                <span className="text-text-muted">IP:</span> {ip}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-[12.5px] text-bad mb-3">{error}</p>}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void handleAuthorize()}
            disabled={state === 'authorizing'}
            className="w-full bg-text text-bg py-[11px] px-[14px] rounded-[7px] text-[13px] font-medium hover:opacity-90 transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            {state === 'authorizing' ? 'Authorizing…' : 'Authorize'}
          </button>
          <button
            type="button"
            onClick={handleDeny}
            disabled={state === 'authorizing'}
            className="w-full border border-border-strong py-[11px] px-[14px] rounded-[7px] text-[13px] text-text-muted hover:text-text transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}

function DeviceFallback() {
  return (
    <div className="min-h-screen bg-bg-elev flex items-center justify-center p-10">
      <div className="w-[440px] max-w-full bg-bg border border-border rounded-lg p-8">
        <div className="text-[13px] text-text-muted">Loading…</div>
      </div>
    </div>
  )
}

export default function DevicePage() {
  return (
    <Suspense fallback={<DeviceFallback />}>
      <DevicePageInner />
    </Suspense>
  )
}
