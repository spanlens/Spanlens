/**
 * Lightweight fetch wrapper for ingest calls.
 *
 * - Never throws (observability must not crash user code).
 * - Retries transient failures (network error, 429, 5xx) with exponential
 *   back-off up to MAX_RETRIES attempts.
 * - Tracks in-flight requests so callers can await flush() before process exit.
 */

import type { SpanlensConfig } from './types.js'

const DOCS_QUICK_START_URL = 'https://www.spanlens.io/docs/quick-start'
const PRICING_URL = 'https://www.spanlens.io/pricing'
const BILLING_URL = 'https://www.spanlens.io/billing'

/**
 * Base typed error for every non-2xx delivery failure the transport can
 * classify. Carries the four fields callers need to branch without string
 * matching: `status` (HTTP status), `code` (server error code when the
 * standard envelope was parseable, `HTTP_<status>` otherwise), `message`,
 * and `endpoint` (e.g. `"POST /ingest/traces"`).
 *
 * This is the value handed to `onError` for HTTP failures (network and
 * timeout failures still pass the raw underlying error, unchanged, so
 * existing `instanceof TypeError` / AbortError handlers keep working).
 */
export class SpanlensTransportError extends Error {
  public readonly code: string
  public readonly status: number
  public readonly endpoint: string

  constructor(args: {
    code: string
    message: string
    status: number
    endpoint?: string
  }) {
    super(args.message)
    this.name = 'SpanlensTransportError'
    this.code = args.code
    this.status = args.status
    this.endpoint = args.endpoint ?? ''
  }
}

/**
 * Sprint 7 R-15 + R-20: typed exception thrown when the Spanlens server
 * responds with the standard error envelope. Callers running with
 * `silent: false` can `instanceof SpanlensApiError` to branch on
 * `error.code` rather than parsing a string message.
 *
 * Extends `SpanlensTransportError` so a single `instanceof
 * SpanlensTransportError` check covers both envelope and non-envelope
 * HTTP failures; existing `instanceof SpanlensApiError` checks keep
 * working unchanged.
 *
 * The shape mirrors `@spanlens/api-types`'s `ApiErrorEnvelope` but is
 * defined here so the SDK has zero dependencies. When `@spanlens/api-types`
 * gets published to npm (currently a workspace-private package) we will
 * switch this file to import the shared interface and drop the duplicate.
 */
export class SpanlensApiError extends SpanlensTransportError {
  public readonly details: Record<string, unknown> | undefined
  public readonly requestId: string | null

  constructor(args: {
    code: string
    message: string
    status: number
    details?: Record<string, unknown>
    requestId: string | null
    endpoint?: string
  }) {
    super(args)
    this.name = 'SpanlensApiError'
    this.details = args.details
    this.requestId = args.requestId
  }
}

/**
 * Actionable, grep-friendly guidance for the failure modes customers hit
 * during integration. Returned text is appended to a `[spanlens]`-prefixed
 * console.warn (deduped per transport) so a misconfigured key or exhausted
 * quota is visible even under the default `silent: true`.
 */
function actionableHint(status: number, code: string | null): string | null {
  if (status === 401) {
    return (
      'Check: (1) the SPANLENS_API_KEY env var is actually loaded in this process, ' +
      '(2) the key was not revoked in the Spanlens dashboard, ' +
      '(3) no whitespace or quotes were pasted around the key. ' +
      `Docs: ${DOCS_QUICK_START_URL}`
    )
  }
  if (status === 403 && code === 'PUBLIC_KEY_WRITE_FORBIDDEN') {
    return (
      'Public keys (sl_live_pub_*) are read-only. Ingest and proxy calls require a full ' +
      'sl_live_ key from the Projects & Keys page. ' +
      `Docs: ${DOCS_QUICK_START_URL}`
    )
  }
  if (status === 429) {
    return (
      'Monthly quota or rate limit hit. ' +
      `Upgrade at ${PRICING_URL} or manage billing at ${BILLING_URL}`
    )
  }
  return null
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
  endpoint: string,
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
    endpoint,
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
  const baseUrl = (config.baseUrl ?? 'https://api.spanlens.io').replace(/\/$/, '')
  const timeoutMs = config.timeoutMs ?? 3000
  const silent = config.silent ?? true
  const onError = config.onError

  // Set of Promises for all in-flight calls — used by flush().
  const pending = new Set<Promise<unknown>>()

  // Actionable-hint dedupe: a broken key fails on EVERY span, so without
  // dedupe a single misconfiguration floods the console. One warn per
  // (status, code) pair per transport instance is enough to be seen.
  const warnedHints = new Set<string>()

  function warnActionable(status: number, code: string | null, endpoint: string): void {
    const hint = actionableHint(status, code)
    if (!hint) return
    const dedupeKey = `${status}:${code ?? ''}`
    if (warnedHints.has(dedupeKey)) return
    warnedHints.add(dedupeKey)
    console.warn(
      `[spanlens] ${endpoint} failed with ${status}${code ? ` ${code}` : ''}. ${hint}`,
    )
  }

  async function callWithRetry(
    method: 'POST' | 'PATCH',
    path: string,
    body: unknown,
  ): Promise<unknown> {
    let lastErr: unknown
    const endpoint = `${method} ${path}`

    // Serialize once, before the retry loop. A circular reference (or any
    // non-serializable value) in user-supplied metadata makes JSON.stringify
    // throw a TypeError. That failure is deterministic — the payload can never
    // serialize — so retrying it is pointless: it would burn all MAX_RETRIES
    // attempts and then silently drop the event. Classify it as non-retryable
    // and fail fast with a clear onError, mirroring the 4xx no-retry path.
    let serializedBody: string
    try {
      serializedBody = JSON.stringify(body)
    } catch (err) {
      safeOnError(
        onError,
        err,
        `${method} ${path}: failed to serialize payload (circular reference in metadata?)`,
      )
      if (!silent) throw err
      return null
    }

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
          body: serializedBody,
          signal: controller.signal,
        })
        // NOTE: the abort timer stays armed through the body read below. A
        // server that returns headers then stalls the body would otherwise
        // hang flush()/beforeExit forever. controller.abort() rejects the
        // pending res.text() so the deadline covers the whole request. The
        // timer is cleared only after the body is fully consumed (on every
        // return path) or in the catch block.

        // 4xx = client error (including 429 quota blocks), don't retry
        if (res.status >= 400 && res.status < 500) {
          const text = await res.text().catch(() => '')
          clearTimeout(timer)
          // If the server speaks the standard error envelope (post Sprint 7
          // R-15), give callers the typed exception so they can branch on
          // error.code without string-comparing the message.
          const apiError = tryParseApiError(text, res.status, endpoint)
          const err: SpanlensTransportError = apiError
            ? apiError
            : new SpanlensTransportError({
                code: `HTTP_${res.status}`,
                status: res.status,
                endpoint,
                message: `[spanlens] ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`,
              })
          // Surface an actionable, deduped console.warn for the common
          // misconfiguration cases (401 bad key, 403 public key on a write
          // endpoint, 429 quota). Under the default silent:true these drops
          // are otherwise invisible.
          warnActionable(res.status, apiError ? apiError.code : null, endpoint)
          safeOnError(onError, err, endpoint)
          if (!silent) throw err
          return null
        }

        // 5xx — retryable
        if (!res.ok) {
          clearTimeout(timer)
          lastErr = new SpanlensTransportError({
            code: `HTTP_${res.status}`,
            status: res.status,
            endpoint,
            message: `[spanlens] ${method} ${path} → ${res.status}`,
          })
          if (attempt < MAX_RETRIES) {
            await sleep(retryDelayMs(attempt))
            continue
          }
          safeOnError(onError, lastErr, endpoint)
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
        // Re-throw immediately for structured HTTP errors. The 4xx branch
        // above intentionally throws (when silent=false) to break out of
        // the retry loop; the 5xx branch throws its final-attempt error.
        // Without this guard the catch would treat those as a transient
        // network error and retry, exhausting the mock and producing a
        // TypeError on the next undefined `res.status` read. Every HTTP
        // failure is now a SpanlensTransportError (SpanlensApiError
        // included, since it extends it), so one instanceof check covers
        // all no-retry throws.
        if (err instanceof SpanlensTransportError) throw err
        // AbortError (timeout) or network failure — retryable.
        // Call onError on every occurrence so callers receive the notification
        // promptly rather than only after all retries are exhausted.
        lastErr = err
        safeOnError(onError, err, endpoint)
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
