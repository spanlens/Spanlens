'use client'

/* eslint-disable no-restricted-imports --
 * This is the single file allowed to import posthog-js: initialisation is
 * gated behind isAnalyticsAllowed() (lib/cookie-consent.ts) and the consent
 * banner (components/cookie-consent-banner.tsx) is mounted in app/layout.tsx.
 * Everything else must go through the typed capture() helper in lib/posthog.ts.
 */
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { Suspense, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { POSTHOG_KEY, POSTHOG_HOST } from '@/lib/posthog'
import { CONSENT_CHANGED_EVENT, isAnalyticsAllowed } from '@/lib/cookie-consent'
import { useCurrentUser } from '@/lib/queries/use-current-user'

// ── Pageview tracker (App Router — no built-in pageview events) ──────────────
// useSearchParams() requires a <Suspense> boundary in the App Router; without
// one, prerendering fails for every page that includes the root layout.

function PageviewTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const ph = usePostHog()

  useEffect(() => {
    if (!pathname) return
    const url = searchParams.size > 0 ? `${pathname}?${searchParams}` : pathname
    ph.capture('$pageview', { $current_url: url })
  }, [pathname, searchParams, ph])

  return null
}

// ── User identify (runs inside PHProvider so usePostHog() is available) ──────

function PostHogIdentify() {
  const { data: user } = useCurrentUser()
  const ph = usePostHog()
  const identifiedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user || identifiedRef.current === user.id) return
    identifiedRef.current = user.id
    ph.identify(user.id, {
      email: user.email ?? undefined,
      created_at: user.created_at,
    })
  }, [user, ph])

  return null
}

// ── Provider ─────────────────────────────────────────────────────────────────
// The SDK is initialised lazily and ONLY after the user opts into analytics
// cookies. `CONSENT_CHANGED_EVENT` lets a mid-session Accept start capture
// without a reload, and a mid-session revoke stops it via opt_out_capturing().

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const initedRef = useRef(false)
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!POSTHOG_KEY) return // skip in test / CI environments without the key

    const sync = () => {
      if (isAnalyticsAllowed()) {
        if (!initedRef.current) {
          initedRef.current = true
          posthog.init(POSTHOG_KEY, {
            api_host: POSTHOG_HOST,
            ui_host: 'https://us.posthog.com',
            // App Router doesn't emit history events, so we track manually via
            // PageviewTracker above. Disable automatic pageview capture here.
            capture_pageview: false,
            capture_pageleave: true,
            // Only create profiles for identified (logged-in) users — avoids
            // inflating MAU counts with anonymous visitors.
            person_profiles: 'identified_only',
          })
        } else {
          posthog.opt_in_capturing()
        }
        setEnabled(true)
      } else if (initedRef.current) {
        posthog.opt_out_capturing()
        setEnabled(false)
      }
    }

    sync()
    window.addEventListener(CONSENT_CHANGED_EVENT, sync)
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, sync)
  }, [])

  return (
    <PHProvider client={posthog}>
      {enabled ? (
        <Suspense fallback={null}>
          <PageviewTracker />
          <PostHogIdentify />
        </Suspense>
      ) : null}
      {children}
    </PHProvider>
  )
}
