'use client'

import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { acceptAll, denyAll, shouldShowBanner } from '@/lib/cookie-consent'

// Hydration-safe "is this the client?" gate. Same pattern as dashboard /
// requests / users — avoids the setState-in-effect lint rule.
const subscribeNoop = () => () => {}
const getTrue = () => true
const getFalse = () => false
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, getTrue, getFalse)
}

/**
 * GDPR / ePrivacy consent banner for non-essential (analytics) cookies.
 * Renders nothing until the client mounts (hydration-safe), and nothing at
 * all when no analytics SDK is configured or the user already decided —
 * both via shouldShowBanner().
 *
 * Accept / decline write through lib/cookie-consent.ts, which dispatches
 * CONSENT_CHANGED_EVENT so the PostHog provider reacts without a reload.
 */
export function CookieConsentBanner() {
  const mounted = useMounted()
  // Dismissal is the only local state; consent itself lives in localStorage
  // via lib/cookie-consent.ts. setState here only happens in click handlers.
  const [dismissed, setDismissed] = useState(false)

  if (!mounted || dismissed || !shouldShowBanner()) return null

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-sm z-50 border border-border rounded-[6px] bg-bg-elev p-4 shadow-lg"
    >
      <p className="font-mono text-[12px] text-text mb-1.5">Cookies</p>
      <p className="font-mono text-[11.5px] text-text-muted mb-3">
        We use optional analytics cookies to understand how the dashboard is
        used. Essential session cookies are always on. See our{' '}
        <Link href="/privacy" className="text-accent hover:opacity-80 transition-opacity">
          privacy policy
        </Link>
        .
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            acceptAll()
            setDismissed(true)
          }}
          className="font-mono text-[11.5px] px-3 py-1.5 rounded-[6px] bg-accent text-bg hover:opacity-90 transition-opacity"
        >
          Accept analytics
        </button>
        <button
          type="button"
          onClick={() => {
            denyAll()
            setDismissed(true)
          }}
          className="font-mono text-[11.5px] px-3 py-1.5 rounded-[6px] border border-border text-text-muted hover:text-text transition-colors"
        >
          Essential only
        </button>
      </div>
    </div>
  )
}
