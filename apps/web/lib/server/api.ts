import 'server-only'
import { createClient } from '@/lib/supabase/server'

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001'

/**
 * Server-side API helper that reads the Supabase session from cookies and
 * forwards the Bearer token to the internal API server.
 *
 * Must be called only from Server Components / Route Handlers.
 */
export async function apiGetServer<T>(path: string): Promise<T> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
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
