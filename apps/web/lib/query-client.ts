import { QueryClient } from '@tanstack/react-query'

/**
 * Create a fresh QueryClient for every React tree.
 *
 * In the browser, we cache a single instance on `globalThis` so React Fast
 * Refresh doesn't throw away the cache between hot reloads. On the server (RSC
 * render), we intentionally make a new client per request — sharing one would
 * leak data between users.
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
