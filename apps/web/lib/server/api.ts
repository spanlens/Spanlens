import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

// Duplicated from lib/workspace-cookie.ts (a 'use client' module) so server
// code stays free of that boundary. If this name changes, change both files.
const WORKSPACE_COOKIE = 'sb-ws'

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001'

// Request-scoped session loader. React `cache()` dedupes calls within a single
// React render — prefetchAll([...10 specs]) used to trigger 10 separate
// Supabase auth roundtrips; with this wrapper it triggers exactly one.
// Per-render, never cross-user — auth security is unaffected.
const getServerSession = cache(async () => {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session
})

// Request-scoped workspace-cookie reader, cached per render the same way
// as getServerSession so layout + page prefetches share a single read.
const getServerWorkspaceCookie = cache(async (): Promise<string | null> => {
  const c = await cookies()
  return c.get(WORKSPACE_COOKIE)?.value ?? null
})

/**
 * Server-side API helper that reads the Supabase session from cookies and
 * forwards the Bearer token to the internal API server.
 *
 * Also forwards the `sb-ws` workspace cookie. Without this the backend's
 * authJwt middleware falls back to the user's oldest org_members row, which
 * means SSR prefetch always sees the user's first workspace regardless of
 * which one the sidebar switcher picked. That mismatch then hydrates the
 * client-side React Query cache with the "wrong" workspace data; a later
 * client-side refetch returns the right workspace, but the already-rendered
 * UI keeps showing the stale value (workspace-switch appears to "do nothing").
 *
 * Must be called only from Server Components / Route Handlers.
 */
export async function apiGetServer<T>(path: string): Promise<T> {
  const [session, sbWs] = await Promise.all([
    getServerSession(),
    getServerWorkspaceCookie(),
  ])
  const token = session?.access_token ?? null

  // TEMP DEBUG (workspace-switcher fix verification): log whether the cookie
  // was read at SSR time and is being forwarded. Remove after confirming.
  console.log('[apiGetServer]', path, 'sbWs=', sbWs ? sbWs.slice(0, 8) : 'null', 'hasToken=', token ? 'yes' : 'no')

  const url = path.startsWith('http') ? path : `${API_URL}${path}`
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Forward ONLY the workspace cookie. Forwarding the full incoming cookie
      // header would leak the Supabase auth-token cookie to the backend
      // unnecessarily (we already pass the access token via Authorization).
      ...(sbWs ? { Cookie: `${WORKSPACE_COOKIE}=${encodeURIComponent(sbWs)}` } : {}),
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Server API ${res.status}: ${path}`)
  }

  return res.json() as Promise<T>
}
