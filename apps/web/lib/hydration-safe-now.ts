'use client'

import { useSyncExternalStore } from 'react'

/**
 * Hydration-safe `Date.now()` for client components.
 *
 * Why this exists: a naive `const [now] = useState(() => Date.now())`
 * captures **server** time during SSR and **browser** time on the first
 * client render. The two diverge by seconds-to-hours depending on
 * Vercel region vs. user timezone, and React fires #418 ("hydration
 * failed") whenever the gap shows up in rendered text (e.g. "fired X
 * mins ago" labels).
 *
 * This hook returns `0` during SSR + the first client paint so the
 * tree hydrates from identical HTML, then returns a cached real
 * timestamp on the post-hydration commit. The cache is module-level
 * so React's identity check sees the same number on every subsequent
 * render — without that, an unmemoized `() => Date.now()` triggers
 * an infinite update loop ("Maximum update depth exceeded") that
 * bubbles up through any client component that subscribes to the
 * store (we hit this with recharts during the demo dashboard fix).
 *
 * Use this anywhere a demo page wants a "now" reference for relative
 * timestamps. Live (authenticated) dashboards should keep using a
 * useEffect + setInterval pattern so they tick — this helper
 * intentionally never updates after first paint.
 *
 * History: introduced after PR #255/#256 fixed the same pattern in
 * /demo/dashboard. /demo/users, /demo/requests, /demo/alerts,
 * /demo/alerts/[id] still had the original useState(() => Date.now())
 * shape and were producing the same #418 in production.
 */
let cachedNow = 0

function getClientNow(): number {
  if (cachedNow === 0) cachedNow = Date.now()
  return cachedNow
}

function getServerNow(): number {
  return 0
}

function subscribeNow(): () => void {
  return () => {}
}

export function useHydrationSafeNow(): number {
  return useSyncExternalStore(subscribeNow, getClientNow, getServerNow)
}
