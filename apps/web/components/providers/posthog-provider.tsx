'use client'

import posthog from 'posthog-js'
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react'
import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { POSTHOG_KEY, POSTHOG_HOST } from '@/lib/posthog'
import { useCurrentUser } from '@/lib/queries/use-current-user'

// ── Pageview tracker (App Router — no built-in pageview events) ──────────────

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

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!POSTHOG_KEY) return   // skip in test / CI environments without the key
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
  }, [])

  return (
    <PHProvider client={posthog}>
      <PageviewTracker />
      <PostHogIdentify />
      {children}
    </PHProvider>
  )
}
