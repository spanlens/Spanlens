import { QueryClient } from '@tanstack/react-query'

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
