'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { useState, type ReactNode } from 'react'
import { getQueryClient } from '@/lib/query-client'

// Lazy-load devtools so they never ship in the production bundle.
// next/dynamic with ssr:false also prevents SSR evaluation of the heavy
// @tanstack/react-query-devtools chunk.
const ReactQueryDevtools =
  process.env.NODE_ENV === 'development'
    ? dynamic(
        () =>
          import('@tanstack/react-query-devtools').then(
            (mod) => mod.ReactQueryDevtools,
          ),
        { ssr: false },
      )
    : () => null

export function QueryProvider({ children }: { children: ReactNode }) {
  // useState initializer ensures the same QueryClient instance is used across
  // all re-renders of this component (including React Strict Mode double render),
  // so HydrationBoundary and child hooks share the same cache. Without this,
  // each render creates a new QC on the server and HydrationBoundary hydrates
  // one instance while useQuery hooks read from a different one → undefined data.
  const [queryClient] = useState(() => getQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  )
}
