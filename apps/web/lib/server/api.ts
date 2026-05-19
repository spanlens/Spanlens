import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001'

// Request-scoped session loader. React `cache()` dedupes calls within a single
// React render — prefetchAll([...10 specs]) used to trigger 10 separate
// Supabase auth roundtrips; with this wrapper it triggers exactly one.
// Per-render, never cross-user — auth security is unaffected.
const getServerSession = cache(async () => {
  // TEMP-VERIFY-STEP2: remove after verification confirms dedup
  console.log('[perf-step2] getServerSession called')
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session
})

/**
 * Server-side API helper that reads the Supabase session from cookies and
 * forwards the Bearer token to the internal API server.
 *
 * Must be called only from Server Components / Route Handlers.
 */
export async function apiGetServer<T>(path: string): Promise<T> {
  const session = await getServerSession()
  const token = session?.access_token ?? null

  const url = path.startsWith('http') ? path : `${API_URL}${path}`
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Server API ${res.status}: ${path}`)
  }

  return res.json() as Promise<T>
}
