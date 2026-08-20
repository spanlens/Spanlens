'use client'

/* eslint-disable no-restricted-imports --
 * This is the single file allowed to import posthog-js. It is never imported
 * statically: posthog-provider.tsx pulls it in through
 * next/dynamic({ ssr: false }) and only once isAnalyticsAllowed()
 * (lib/cookie-consent.ts) returns true, so the SDK bytes are not downloaded at
 * all by a visitor who has not opted into analytics cookies. The consent
 * banner lives in components/cookie-consent-banner.tsx, mounted from
 * app/layout.tsx. Everything else must go through the typed capture() helper
 * in lib/posthog.ts.
 */
import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { Suspense, useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { POSTHOG_KEY, POSTHOG_HOST } from '@/lib/posthog'
import { useCurrentUser } from '@/lib/queries/use-current-user'

// ── SDK initialisation ───────────────────────────────────────────────────────
// Init runs at module scope rather than inside an effect, for two reasons:
//
//  1. Evaluating this module IS the consent gate. The module is only ever
//     reached via the dynamic import in posthog-provider.tsx, which renders
//     the bridge only when consent has been granted.
//  2. Ordering. React runs child effects before parent effects, so an init()
//     inside PostHogBridge's own effect would fire *after* PageviewTracker had
//     already tried to capture the first `$pageview`, silently dropping it.
//
// The `typeof window` guard is belt-and-braces: `ssr: false` already keeps
// this module off the server, but a future static import must not crash SSR.
if (typeof window !== 'undefined' && POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    ui_host: 'https://us.posthog.com',
    // App Router doesn't emit history events, so we track manually via
    // PageviewTracker below. Disable automatic pageview capture here.
    capture_pageview: false,
    capture_pageleave: true,
    // Only create profiles for identified (logged-in) users — avoids
    // inflating MAU counts with anonymous visitors.
    person_profiles: 'identified_only',
  })
}

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

// ── Bridge ───────────────────────────────────────────────────────────────────
// Deliberately does NOT wrap the app's `children`. PHProvider only has to be
// an ancestor of the two components that call usePostHog(), and keeping
// `children` outside means a mid-session consent flip mounts/unmounts this
// subtree without re-parenting (and therefore without remounting) the rest of
// the app.

export function PostHogBridge() {
  useEffect(() => {
    if (!POSTHOG_KEY) return

    // Being mounted means consent is currently granted. On the very first
    // mount this is a no-op (init() leaves the client opted in); after a
    // revoke → re-accept cycle it is what resumes capture without a reload.
    posthog.opt_in_capturing()

    // Unmounting means posthog-provider.tsx observed the consent flip to
    // denied. opt_out_capturing() is idempotent and safe on an already
    // opted-out client.
    return () => {
      posthog.opt_out_capturing()
    }
  }, [])

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PageviewTracker />
        <PostHogIdentify />
      </Suspense>
    </PHProvider>
  )
}
