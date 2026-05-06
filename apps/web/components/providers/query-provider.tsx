'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import type { ReactNode } from 'react'
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
  // getQueryClient() returns the same singleton in the browser, fresh on server.
  const queryClient = getQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
    </QueryClientProvider>
  )
}
