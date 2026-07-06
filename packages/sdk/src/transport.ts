/**
 * Lightweight fetch wrapper for ingest calls.
 *
 * - Never throws (observability must not crash user code).
 * - Retries transient failures (network error, 429, 5xx) with exponential
 *   back-off up to MAX_RETRIES attempts.
 * - Tracks in-flight requests so callers can await flush() before process exit.
 */

import type { SpanlensConfig } from './types.js'

/**
 * Sprint 7 R-15 + R-20: typed exception thrown when the Spanlens server
 * responds with the standard error envelope. Callers running with
 * `silent: false` can `instanceof SpanlensApiError` to branch on
 * `error.code` rather than parsing a string message.
 *
 * The shape mirrors `@spanlens/api-types`'s `ApiErrorEnvelope` but is
 * defined here so the SDK has zero dependencies. When `@spanlens/api-types`
 * gets published to npm (currently a workspace-private package) we will
 * switch this file to import the shared interface and drop the duplicate.
 */
export class SpanlensApiError extends Error {
  public readonly code: string
  public readonly status: number
  public readonly details: Record<string, unknown> | undefined
  public readonly requestId: string | null

  constructor(args: {
    code: string
    message: string
    status: number
    details?: Record<string, unknown>
    requestId: string | null
  }) {
    super(args.message)
    this.name = 'SpanlensApiError'
    this.code = args.code
    this.status = args.status
    this.details = args.details
    this.requestId = args.requestId
  }
}

interface ApiErrorEnvelopeLike {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
    requestId?: string | null
  }
}

/**
 * Parse a server response body that may be the standard ApiErrorEnvelope.
 * Returns the typed exception when the shape matches, null otherwise so
 * the caller can fall back to its previous generic-Error path.
 */
function tryParseApiError(
  text: string,
  status: number,
): SpanlensApiError | null {
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed == null || typeof parsed !== 'object') return null
  const maybe = parsed as { error?: unknown }
  if (maybe.error == null || typeof maybe.error !== 'object') return null
  const env = maybe as ApiErrorEnvelopeLike
  if (typeof env.error.code !== 'string' || typeof env.error.message !== 'string') {
    return null
  }
  // Spread `details` conditionally so we do not pass `undefined` to the
  // optional parameter (exactOptionalPropertyTypes rejects that).
  return new SpanlensApiError({
    code: env.error.code,
    message: env.error.message,
    status,
    ...(env.error.details ? { details: env.error.details } : {}),
    requestId: env.error.requestId ?? null,
  })
}

export interface Transport {
  post(path: string, body: unknown): Promise<unknown>
  patch(path: string, body: unknown): Promise<unknown>
  /** Resolves when all in-flight ingest calls have settled. */
  flush(): Promise<void>
}

const MAX_RETRIES = 3

/** ms to wait before the nth retry: 200, 400, 800 */
function retryDelayMs(attempt: number): number {
  return 200 * Math.pow(2, attempt - 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Invoke the user-supplied onError callback without ever letting it throw.
 * These transport calls run fire-and-forget from span.end(); if a user's
 * callback threw here the promise would reject even under `silent: true`,
 * surfacing as an unhandled rejection that can crash the host process. The
 * SDK's "never crash user code" guarantee means a user callback must never
 * escape.
 */
function safeOnError(
  cb: SpanlensConfig['onError'],
  err: unknown,
  meta: string,
): void {
  try {
    cb?.(err, meta)
  } catch {
    /* user callback must never crash the SDK */
  }
}

export function createTransport(config: SpanlensConfig): Transport {
  const baseUrl = (config.baseUrl ?? 'https://spanlens-server.vercel.app').replace(/\/$/, '')
  const timeoutMs = config.timeoutMs ?? 3000
  const silent = config.silent ?? true
  const onError = config.onError

  // Set of Promises for all in-flight calls — used by flush().
  const pending = new Set<Promise<unknown>>()

  async function callWithRetry(
    method: 'POST' | 'PATCH',
    path: string,
    body: unknown,
  ): Promise<unknown> {
    let lastErr: unknown

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        // NOTE: the abort timer stays armed through the body read below. A
        // server that returns headers then stalls the body would otherwise
        // hang flush()/beforeExit forever. controller.abort() rejects the
        // pending res.text() so the deadline covers the whole request. The
        // timer is cleared only after the body is fully consumed (on every
        // return path) or in the catch block.

        // 4xx = client error, don't retry
        if (res.status >= 400 && res.status < 500) {
          const text = await res.text().catch(() => '')
          clearTimeout(timer)
          // If the server speaks the standard error envelope (post Sprint 7
          // R-15), give callers the typed exception so they can branch on
          // error.code without string-comparing the message.
          const apiError = tryParseApiError(text, res.status)
          const err = apiError
            ? apiError
            : new Error(`[spanlens] ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
          safeOnError(onError, err, `${method} ${path}`)
          if (!silent) throw err
          return null
        }

        // 5xx / 429 — retryable
        if (!res.ok) {
          clearTimeout(timer)
          lastErr = new Error(`[spanlens] ${method} ${path} → ${res.status}`)
          if (attempt < MAX_RETRIES) {
            await sleep(retryDelayMs(attempt))
            continue
          }
          safeOnError(onError, lastErr, `${method} ${path}`)
          if (!silent) throw lastErr
          return null
        }

        // Body read is still covered by the abort timer (armed above); it is
        // cleared only once the full body has been consumed.
        const text = await res.text()
        clearTimeout(timer)
        if (!text) return null
        try { return JSON.parse(text) } catch { return null }
      } catch (err) {
        clearTimeout(timer)
        // Re-throw immediately for 4xx errors. The 4xx branch above
        // intentionally throws (when silent=false) to break out of the
        // retry loop. Without this guard the catch would treat the
        // structured 4xx as a transient network error and retry,
        // exhausting the mock and producing a TypeError on the next
        // undefined `res.status` read. SpanlensApiError plus the
        // plain "[spanlens] ... -> 4xx" Error both originate from
        // the no-retry branch, so a single `instanceof` check on the
        // typed class plus a string check on the plain prefix covers
        // them. Using a sentinel property would be cleaner; defer to a
        // follow-up since it touches the existing Error shape that
        // user code may already match on.
        if (err instanceof SpanlensApiError) throw err
        if (
          err instanceof Error &&
          err.message.startsWith(`[spanlens] ${method} ${path} -> 4`)
        ) {
          throw err
        }
        // AbortError (timeout) or network failure — retryable.
        // Call onError on every occurrence so callers receive the notification
        // promptly rather than only after all retries are exhausted.
        lastErr = err
        safeOnError(onError, err, `${method} ${path}`)
        if (attempt < MAX_RETRIES) {
          await sleep(retryDelayMs(attempt))
          continue
        }
        if (!silent) throw err
        return null
      }
    }

    return null
  }

  function tracked(promise: Promise<unknown>): Promise<unknown> {
    pending.add(promise)
    promise.finally(() => pending.delete(promise)).catch(() => { /* handled inside */ })
    return promise
  }

  return {
    post: (path, body) => tracked(callWithRetry('POST', path, body)),
    patch: (path, body) => tracked(callWithRetry('PATCH', path, body)),
    flush: () => Promise.allSettled([...pending]).then(() => undefined),
  }
}
