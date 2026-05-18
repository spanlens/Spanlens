'use client'
import { useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import {
  acceptAll,
  denyAll,
  readConsent,
  shouldShowBanner,
} from '@/lib/cookie-consent'

/**
 * Cookie consent banner — scaffold for the future.
 *
 * Currently `shouldShowBanner()` returns false unconditionally because
 * Spanlens does not load any non-essential cookies. When the first
 * analytics or marketing cookie is added:
 *   1. Flip `shouldShowBanner()` in `lib/cookie-consent.ts` to gate on
 *      `!readConsent().decided`.
 *   2. Mount `<CookieConsentBanner />` from `app/layout.tsx`.
 *   3. Gate the analytics SDK initialization on `isAnalyticsAllowed()`.
 *
 * The consent state is subscribed via `useSyncExternalStore` so cross-tab
 * `storage` events keep the banner state synchronised across tabs.
 */

function subscribeToConsent(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('storage', notify)
  return () => window.removeEventListener('storage', notify)
}

function getDecided(): boolean {
  return readConsent().decided
}

function getServerDecided(): boolean {
  // SSR: treat as decided so the banner never appears in the initial HTML.
  // This avoids a flash of the banner before hydration on returning visitors.
  return true
}

export function CookieConsentBanner() {
  const decided = useSyncExternalStore(subscribeToConsent, getDecided, getServerDecided)
  const [dismissed, setDismissed] = useState(false)

  if (!shouldShowBanner()) return null
  if (decided) return null
  if (dismissed) return null

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(640px,calc(100vw-32px))]
        z-50 border border-border bg-bg-elev rounded-lg shadow-lg p-4
        text-[13px] text-text"
    >
      <p className="mb-3 leading-relaxed">
        We use cookies that are strictly necessary for the service to function (your
        authenticated session). If you accept, we additionally use optional cookies for
        product analytics so we can understand which features get the most use. You can
        change your preference any time from the{' '}
        <Link href="/privacy">Privacy Policy</Link> page.
      </p>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => {
            denyAll()
            setDismissed(true)
          }}
          className="px-3 py-1.5 text-[12px] rounded-md border border-border
            hover:bg-bg-muted transition-colors"
        >
          Essential only
        </button>
        <button
          type="button"
          onClick={() => {
            acceptAll()
            setDismissed(true)
          }}
          className="px-3 py-1.5 text-[12px] rounded-md bg-text text-bg
            hover:opacity-90 transition-opacity"
        >
          Accept all
        </button>
      </div>
    </div>
  )
}
