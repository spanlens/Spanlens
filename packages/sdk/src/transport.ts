/**
 * Lightweight fetch wrapper for ingest calls.
 *
 * - Never throws (observability must not crash user code).
 * - Retries transient failures (network error, 429, 5xx) with exponential
 *   back-off up to MAX_RETRIES attempts.
 * - Tracks in-flight requests so callers can await flush() before process exit.
 */

import type { SpanlensConfig } from './types.js'

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
        clearTimeout(timer)

        // 4xx = client error, don't retry
        if (res.status >= 400 && res.status < 500) {
          const text = await res.text().catch(() => '')
          const err = new Error(`[spanlens] ${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
          onError?.(err, `${method} ${path}`)
          if (!silent) throw err
          return null
        }

        // 5xx / 429 — retryable
        if (!res.ok) {
          lastErr = new Error(`[spanlens] ${method} ${path} → ${res.status}`)
          if (attempt < MAX_RETRIES) {
            await sleep(retryDelayMs(attempt))
            continue
          }
          onError?.(lastErr, `${method} ${path}`)
          if (!silent) throw lastErr
          return null
        }

        const text = await res.text()
        if (!text) return null
        try { return JSON.parse(text) } catch { return null }
      } catch (err) {
        clearTimeout(timer)
        // AbortError (timeout) or network failure — retryable
        lastErr = err
        if (attempt < MAX_RETRIES) {
          await sleep(retryDelayMs(attempt))
          continue
        }
        onError?.(err, `${method} ${path}`)
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
