/**
 * Upstream fetch + abort timer shared by all 4 proxy handlers.
 *
 * Each provider previously duplicated the same 20-line block:
 *   - AbortController + setTimeout(abort, UPSTREAM_TIMEOUT_MS)
 *   - try/catch around fetch
 *   - clearTimeout on success AND failure paths
 *   - throw UPSTREAM_TIMEOUT or UPSTREAM_FAILED with provider details
 *   - measure latencyMs from startMs to fetch-return
 *
 * Centralising means a future change (e.g. swapping in a retrying fetch
 * for 5xx upstream errors) edits one file instead of four.
 */

import { ApiError } from '../../lib/errors.js'
import { logError } from '../../lib/structured-logger.js'
import type { ProxyProvider } from './provider-key.js'

const UPSTREAM_TIMEOUT_MS = parseInt(process.env['UPSTREAM_TIMEOUT_MS'] ?? '35000', 10)

export interface UpstreamFetchResult {
  upstreamRes: Response
  /** Wall-clock from initiating fetch to receiving response headers. */
  latencyMs: number
  /** Pre-fetch overhead inside our handler: auth, key decrypt, body parse. */
  proxyOverheadMs: number
}

export interface UpstreamFetchOptions {
  url: string
  method: string
  headers: Headers
  body: string | null
  provider: ProxyProvider
  /** Set to Date.now() at the very start of the request handler. */
  handlerStartMs: number
}

export async function fetchUpstreamWithTimeout(
  opts: UpstreamFetchOptions,
): Promise<UpstreamFetchResult> {
  const startMs = Date.now()
  const upstreamAbort = new AbortController()
  const upstreamTimer = setTimeout(() => upstreamAbort.abort(), UPSTREAM_TIMEOUT_MS)

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: upstreamAbort.signal,
    })
  } catch (err) {
    clearTimeout(upstreamTimer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(
        'UPSTREAM_TIMEOUT',
        `Upstream request timed out after ${UPSTREAM_TIMEOUT_MS}ms`,
        { provider: opts.provider, timeoutMs: UPSTREAM_TIMEOUT_MS },
      )
    }
    const msg = err instanceof Error ? err.message : 'Unknown error'
    logError('UPSTREAM_FETCH_FAILED', { provider: opts.provider }, err)
    throw new ApiError('UPSTREAM_FAILED', `Upstream request failed: ${msg}`, {
      provider: opts.provider,
    })
  }

  clearTimeout(upstreamTimer)
  return {
    upstreamRes,
    latencyMs: Date.now() - startMs,
    proxyOverheadMs: startMs - opts.handlerStartMs,
  }
}
