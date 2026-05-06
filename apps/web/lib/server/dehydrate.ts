import 'server-only'
import { dehydrate } from '@tanstack/react-query'
import { makeQueryClient } from '@/lib/query-client'

export interface QuerySpec<T = unknown> {
  queryKey: readonly unknown[]
  queryFn: () => Promise<T>
  staleTime?: number
}

/**
 * Prefetches all provided queries in parallel on the server and returns the
 * dehydrated state to be passed to a client-side `<HydrationBoundary>`.
 *
 * Uses `Promise.allSettled` so a single failing query doesn't block the rest.
 */
export async function prefetchAll(specs: QuerySpec[]): Promise<ReturnType<typeof dehydrate>> {
  const qc = makeQueryClient()
  await Promise.allSettled(
    specs.map((s) =>
      qc.prefetchQuery({
        queryKey: s.queryKey,
        queryFn: s.queryFn,
        ...(s.staleTime !== undefined ? { staleTime: s.staleTime } : {}),
      }),
    ),
  )
  return dehydrate(qc)
}
