'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { POSTHOG_KEY } from '@/lib/posthog'
import { CONSENT_CHANGED_EVENT, isAnalyticsAllowed } from '@/lib/cookie-consent'

// posthog-js + posthog-js/react are ~76 KB gzip and used to sit in the shared
// client chunk that EVERY page downloads — marketing, docs, /privacy, the lot —
// even though posthog.init() was already correctly gated behind cookie consent.
// The gate stopped the SDK from running; it did not stop it from being
// downloaded.
//
// Loading the bridge through next/dynamic({ ssr: false }) moves posthog-js into
// its own lazy chunk that is fetched only after the visitor opts into analytics
// cookies. This file keeps the consent state machine and must NOT import
// posthog-js — see components/providers/posthog-bridge.tsx for everything that
// touches the SDK.
const PostHogBridge = dynamic(
  () => import('./posthog-bridge').then((m) => m.PostHogBridge),
  { ssr: false },
)

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [consented, setConsented] = useState(false)

  useEffect(() => {
    if (!POSTHOG_KEY) return // skip in test / CI environments without the key

    // `CONSENT_CHANGED_EVENT` lets a mid-session Accept mount the bridge (which
    // downloads + initialises the SDK) and a mid-session revoke unmount it —
    // both without a page reload. The bridge's own unmount cleanup is what
    // calls opt_out_capturing().
    const sync = () => setConsented(isAnalyticsAllowed())

    sync()
    window.addEventListener(CONSENT_CHANGED_EVENT, sync)
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, sync)
  }, [])

  // `children` sits at a fixed position in both states, and the bridge is a
  // sibling rather than a wrapper. That matters: the previous version wrapped
  // children in PostHogProvider-from-the-SDK, so toggling consent would have
  // re-parented and remounted the entire app tree (blowing away dashboard
  // state). Rendering `{children}` unchanged in both branches avoids that.
  return (
    <>
      {consented ? <PostHogBridge /> : null}
      {children}
    </>
  )
}
