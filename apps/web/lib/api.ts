'use client'
import { createClient } from './supabase/client'

/**
 * Browser-side API client.
 *
 * Two performance decisions worth knowing:
 *
 * 1. Same-origin. Paths are relative (e.g. `/api/v1/stats/overview`);
 *    Next.js rewrites (next.config.mjs) forward them to the upstream
 *    spanlens-server. No CORS preflight → ~50–150ms saved per query.
 *
 * 2. Session memoization. `supabase.auth.getSession()` reads from IndexedDB
 *    on each call (5–30ms). With 3–4 TanStack queries per page the
 *    overhead compounds. We cache the access token for SESSION_TTL_MS so
 *    the 2nd…Nth fetch on the same page skips IndexedDB. The cache is
 *    invalidated via `onAuthStateChange` on sign-in / sign-out / token
 *    refresh.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

const SESSION_TTL_MS = 10_000 // 10s — well under the default 1h access-token lifetime

interface CachedSession {
  token: string | null
  fetchedAt: number
}

let cached: CachedSession | null = null
let listenerAttached = false

function invalidateSession() {
  cached = null
}

function ensureAuthListener(): void {
  if (listenerAttached) return
  listenerAttached = true
  try {
    const supabase = createClient()
    supabase.auth.onAuthStateChange(() => {
      invalidateSession()
    })
  } catch {
    // createClient may throw during SSR — harmless here because this module
    // is 'use client' and only runs in the browser. Swallow to be safe.
  }
}

async function getAuthToken(): Promise<string | null> {
  ensureAuthListener()

  if (cached && Date.now() - cached.fetchedAt < SESSION_TTL_MS) {
    return cached.token
  }

  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  cached = {
    token: session?.access_token ?? null,
    fetchedAt: Date.now(),
  }
  return cached.token
}

async function buildHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getAuthToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: await buildHeaders(),
    cache: 'no-store',
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: await buildHeaders(),
    body: body !== undefined ? JSON.stringify(body) : null,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: await buildHeaders(),
    body: body !== undefined ? JSON.stringify(body) : null,
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: 'DELETE',
    headers: await buildHeaders(),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}
