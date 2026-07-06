import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query'
import { ApiError } from './api'

/**
 * Global 401 handler.
 *
 * When any query or mutation fails with a 401 (expired / blank session), the
 * cached data on screen is stale and every poll silently errors. Redirect the
 * user to /login via a HARD navigation (`window.location.href`) — a soft
 * `router.push` would keep the RSC tree + middleware state (see CLAUDE.md
 * gotcha #15), so the fresh middleware pass that clears the session never runs.
 *
 * Guarded so it fires only in the browser, only once (a module-level flag), and
 * never while already on /login — otherwise a 401 from a login-page query would
 * loop the redirect.
 */
let redirectingToLogin = false

function handleGlobalError(error: unknown): void {
  if (typeof window === 'undefined') return
  if (!(error instanceof ApiError) || error.status !== 401) return
  if (redirectingToLogin) return
  if (window.location.pathname === '/login') return
  redirectingToLogin = true
  window.location.href = '/login'
}

/**
 * Create a fresh QueryClient for every React tree.
 *
 * In the browser, we cache a single instance on `globalThis` so React Fast
 * Refresh doesn't throw away the cache between hot reloads. On the server (RSC
 * render), we intentionally make a new client per request — sharing one would
 * leak data between users.
 *
 * Live-update strategy (P3.9, 2026-05-19)
 * ---------------------------------------
 * Spanlens does NOT use SSE / WebSocket for dashboard freshness. Instead the
 * stack is:
 *
 *   1. Per-hook `refetchInterval` — each "live" query (requests, stats,
 *      anomalies, system) sets its own polling interval, picking from the
 *      named constants in `lib/queries/live-polling.ts`. Background tabs
 *      pause automatically (TanStack default `refetchIntervalInBackground: false`).
 *   2. `refetchOnWindowFocus: true` (set below) — when the user returns to
 *      the tab, every visible query refetches instantly, even mid-interval.
 *      This is what makes the dashboard feel "live" without paying for SSE.
 *   3. `staleTime: 60_000` — within a minute of a successful fetch a
 *      remounted component reuses the cache. Page navigation stays snappy.
 *
 * A previous attempt used Supabase Realtime on `public.requests`; that table
 * moved to ClickHouse in the P1.5 migration and the realtime hook (now
 * deleted) silently delivered zero events for months. The polling-based
 * approach above is the deliberate replacement — simpler, observable, and
 * sufficient for current traffic. Reassess if dashboard latency becomes
 * customer-visible at scale.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    // A single onError on both caches catches every query AND mutation failure,
    // so the 401 redirect is wired in exactly one place.
    queryCache: new QueryCache({ onError: handleGlobalError }),
    mutationCache: new MutationCache({ onError: handleGlobalError }),
    defaultOptions: {
      queries: {
        // staleTime: how long a query is considered fresh. Within this window,
        // re-mounting a component does NOT refetch — the cache is reused. Set
        // high enough that page transitions feel instant.
        staleTime: 60_000, // 1 minute
        // gcTime: how long unused caches stay in memory before garbage collection.
        gcTime: 5 * 60_000, // 5 minutes
        // Refetch when the user returns to the tab — keeps data live without
        // eagerly polling.
        refetchOnWindowFocus: true,
        // Retry transient failures once.
        retry: 1,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    // Server: always fresh per request to avoid cross-request leakage.
    return makeQueryClient()
  }
  // Client: reuse the same instance across HMR reloads.
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}

/**
 * Wipe every cached query on the browser client.
 *
 * Call this on sign-out: the `browserQueryClient` singleton persists across a
 * soft navigation, and query keys don't include the orgId, so without an
 * explicit clear the next account that signs in on the same tab would mount
 * against the previous account's cached stats / quota / org name until
 * staleTime elapses. Pair with a hard nav for a fully fresh context.
 */
export function clearQueryClient(): void {
  browserQueryClient?.clear()
}
