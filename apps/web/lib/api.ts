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
    /**
     * The stable `error.code` from the server's catalog, when the response used
     * the unified envelope. Branch on this rather than on the message: the
     * prose is written for a human and will be reworded.
     */
    public code: string | null = null,
  ) {
    super(message)
  }
}

/**
 * Extract a human message from a failed-response body. The server uses two
 * shapes: the legacy `{ error: '<message>' }` (many handlers) and the unified
 * ApiError envelope `{ error: { code, message, details, requestId } }` (the
 * onError handler in apps/server). Handle both so an ApiError response shows
 * its real message instead of "[object Object]".
 */
function extractErrorMessage(body: unknown, status: number): string {
  const err = (body as { error?: unknown } | null | undefined)?.error
  if (typeof err === 'string' && err.length > 0) return err
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  return `HTTP ${status}`
}

/** The envelope's `error.code`, or null for the legacy string shape. */
function extractErrorCode(body: unknown): string | null {
  const err = (body as { error?: unknown } | null | undefined)?.error
  if (err && typeof err === 'object') {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return null
}

const SESSION_TTL_MS = 10_000 // 10s, well under the default 1h access-token lifetime

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
    const body = await res.json().catch(() => ({}))
    throw new ApiError(extractErrorMessage(body, res.status), res.status, extractErrorCode(body))
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
    const body = await res.json().catch(() => ({}))
    throw new ApiError(extractErrorMessage(body, res.status), res.status, extractErrorCode(body))
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
    const body = await res.json().catch(() => ({}))
    throw new ApiError(extractErrorMessage(body, res.status), res.status, extractErrorCode(body))
  }
  return res.json() as Promise<T>
}

/**
 * The response started but did not finish: the connection dropped, or the
 * server aborted it because the export failed partway through (a streamed
 * export has already answered 200 by then, so aborting is the only signal it
 * has). Nothing was saved.
 */
export class DownloadInterruptedError extends Error {
  constructor(message = 'The download was interrupted before it finished, so nothing was saved.') {
    super(message)
    this.name = 'DownloadInterruptedError'
  }
}

export interface DownloadOptions {
  /** Called with the running byte count as the body arrives. */
  onProgress?: (receivedBytes: number) => void
}

/** Reads the whole body, reporting progress, or throws DownloadInterruptedError. */
async function readBody(res: Response, onProgress?: (receivedBytes: number) => void): Promise<Uint8Array[]> {
  if (!res.body) return [new Uint8Array(await res.arrayBuffer())]
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.byteLength
      onProgress?.(received)
    }
  } catch {
    // No Content-Length check on top: the browser already fails a body cut
    // short of it, and under gzip/brotli the header counts compressed bytes,
    // which would flag small complete bodies as truncated.
    throw new DownloadInterruptedError()
  }
  return chunks
}

/**
 * Downloads an authenticated export and saves it under `filename`.
 *
 * The body is read here rather than with `res.blob()` so progress can be shown
 * and so a body that fails partway through rejects with
 * DownloadInterruptedError instead of saving a truncated file. The file is
 * still assembled in memory before the browser saves it; streaming straight
 * to disk needs the File System Access API, which only Chromium ships.
 */
export async function apiDownload(
  path: string,
  filename: string,
  options: DownloadOptions = {},
): Promise<{ bytes: number }> {
  const token = await getAuthToken()
  const res = await fetch(path, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(extractErrorMessage(body, res.status), res.status, extractErrorCode(body))
  }
  const chunks = await readBody(res, options.onProgress)
  const blob = new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { bytes: blob.size }
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: 'DELETE',
    headers: await buildHeaders(),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(extractErrorMessage(body, res.status), res.status, extractErrorCode(body))
  }
  return res.json() as Promise<T>
}
