/**
 * Upstream fetch + abort timers shared by every proxy handler.
 *
 * Each provider previously duplicated the same 20-line block:
 *   - AbortController + setTimeout(abort, UPSTREAM_TIMEOUT_MS)
 *   - try/catch around fetch
 *   - clearTimeout on success AND failure paths
 *   - throw UPSTREAM_TIMEOUT or UPSTREAM_FAILED with provider details
 *   - measure latencyMs from startMs to fetch-return
 *
 * Centralising means a future change (e.g. swapping in a retrying fetch
 * for 5xx upstream errors) edits one file instead of ten.
 *
 * Transport failures are logged as request rows here, before the ApiError
 * propagates. A provider that answers with an HTTP error is logged by the
 * handler like any other response; a call that never got a usable response
 * (connection refused, no headers in time, a body that stalled or dropped)
 * used to throw straight past the handler's logging and leave no row, so it
 * was invisible to /requests, error rates and alerts.
 */

import type { Context } from 'hono'
import { ApiError, type ErrorCode } from '../../lib/errors.js'
import { logRequestAsync } from '../../lib/logger.js'
import type { SecurityFlag } from '../../lib/security-scan.js'
import { logError } from '../../lib/structured-logger.js'
import { fireAndForget } from '../../lib/wait-until.js'
import { STREAM_DEADLINE_MS } from '../stream-deadline.js'
import type { ResolvedProviderKey } from '../utils.js'
import { buildLogBase } from './log-base.js'
import type { ProxyProvider } from './provider-key.js'
import { describeTransportError } from './upstream-errors.js'

/** Bound on waiting for the provider's response headers. */
const UPSTREAM_TIMEOUT_MS = parseInt(process.env['UPSTREAM_TIMEOUT_MS'] ?? '35000', 10)

/**
 * Bound on receiving a complete NON-streaming response body, counted from
 * the request reaching the proxy (like the stream deadline, which it
 * defaults to). The header timer above is cleared once headers arrive, so
 * without this a connection that went quiet mid-body held the function until
 * Vercel killed it, and the row that would have recorded the call was lost
 * with it (gotcha #8). It is deliberately a whole-response budget rather than
 * a short idle timer: some providers (OpenRouter among them) send headers
 * right away and keep a non-streaming connection open with whitespace until
 * a long generation finishes. Streams are bounded separately, per read, by
 * stream-deadline.ts.
 */
const UPSTREAM_BODY_DEADLINE_MS = parseInt(
  process.env['UPSTREAM_BODY_DEADLINE_MS'] ?? String(STREAM_DEADLINE_MS),
  10,
)

/** What a failed-request row needs that the transport layer does not know. */
export interface UpstreamFailureLog {
  c: Context
  organizationId: string
  projectId: string
  apiKeyId: string
  providerKey: ResolvedProviderKey
  reqBodyJson: Record<string, unknown> | null
  requestFlags: SecurityFlag[]
  /** The model the caller asked for: a failed call has no response to read one from. */
  model: string
}

export interface UpstreamFetchResult {
  upstreamRes: Response
  /**
   * Upstream time: from sending the request to the provider until its
   * response headers arrive. For a stream that is time to first byte; the
   * generation after it is not included.
   */
  latencyMs: number
  /**
   * Everything Spanlens did before calling the provider, measured from the
   * request reaching the proxy (middleware/requestStart.ts): auth, rate
   * limits, quota, key decryption, body parsing, the security scan and the
   * cache lookup.
   */
  proxyOverheadMs: number
  /**
   * Reads a non-streaming response body under UPSTREAM_BODY_DEADLINE_MS. On
   * expiry, or when the connection drops mid-body, it logs a failed-request
   * row and throws UPSTREAM_TIMEOUT (504) / UPSTREAM_FAILED (502). Use this
   * instead of `upstreamRes.text()`.
   */
  readBodyText: () => Promise<string>
}

export interface UpstreamFetchOptions {
  url: string
  method: string
  headers: Headers
  body: string | null
  provider: ProxyProvider
  /** When the request reached the proxy: getRequestStartMs(c). */
  requestStartMs: number
  /** Context for the failed-request row a transport failure leaves behind. */
  failureLog: UpstreamFailureLog
}

/** One transport failure, described for the client and for the log row. */
interface UpstreamFailure {
  code: Extract<ErrorCode, 'UPSTREAM_TIMEOUT' | 'UPSTREAM_FAILED'>
  /** Message on the ApiError the client receives. */
  clientMessage: string
  /** Row error_message: classified, never the raw error text. */
  rowMessage: string
  details: Record<string, unknown>
}

const STATUS_BY_CODE: Readonly<Record<UpstreamFailure['code'], number>> = {
  UPSTREAM_TIMEOUT: 504,
  UPSTREAM_FAILED: 502,
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

function describeFetchFailure(provider: ProxyProvider, err: unknown): UpstreamFailure {
  if (isAbortError(err)) {
    return {
      code: 'UPSTREAM_TIMEOUT',
      clientMessage: `Upstream request timed out after ${UPSTREAM_TIMEOUT_MS}ms`,
      rowMessage: `Upstream did not return response headers within ${UPSTREAM_TIMEOUT_MS}ms`,
      details: { provider, timeoutMs: UPSTREAM_TIMEOUT_MS },
    }
  }
  const msg = err instanceof Error ? err.message : 'Unknown error'
  return {
    code: 'UPSTREAM_FAILED',
    clientMessage: `Upstream request failed: ${msg}`,
    rowMessage: describeTransportError('Upstream request failed before a response', err),
    details: { provider },
  }
}

function describeBodyTimeout(provider: ProxyProvider): UpstreamFailure {
  return {
    code: 'UPSTREAM_TIMEOUT',
    clientMessage: `Upstream response body timed out after ${UPSTREAM_BODY_DEADLINE_MS}ms`,
    rowMessage: `Upstream response body did not finish within ${UPSTREAM_BODY_DEADLINE_MS}ms of the request`,
    details: { provider, timeoutMs: UPSTREAM_BODY_DEADLINE_MS },
  }
}

function describeBodyFailure(provider: ProxyProvider, err: unknown): UpstreamFailure {
  const msg = err instanceof Error ? err.message : 'Unknown error'
  return {
    code: 'UPSTREAM_FAILED',
    clientMessage: `Upstream response body could not be read: ${msg}`,
    rowMessage: describeTransportError('Upstream connection dropped while reading the response body', err),
    details: { provider },
  }
}

/**
 * Logs the failed call as a request row (off the response path, gotcha #8)
 * and returns the ApiError for the caller to throw. The row carries the
 * status the client receives, the requested model, zero tokens and a null
 * cost: nothing came back that could be billed or priced.
 */
function failUpstream(
  opts: UpstreamFetchOptions,
  fetchStartMs: number,
  failure: UpstreamFailure,
  cause: unknown,
): ApiError {
  const statusCode = STATUS_BY_CODE[failure.code]
  logError('UPSTREAM_FETCH_FAILED', { provider: opts.provider, kind: failure.code, statusCode }, cause)

  const log = opts.failureLog
  const base = buildLogBase({
    c: log.c,
    provider: opts.provider,
    organizationId: log.organizationId,
    projectId: log.projectId,
    apiKeyId: log.apiKeyId,
    providerKey: log.providerKey,
    reqBodyJson: log.reqBodyJson,
    requestFlags: log.requestFlags,
    latencyMs: Date.now() - fetchStartMs,
    proxyOverheadMs: fetchStartMs - opts.requestStartMs,
    statusCode,
  })
  fireAndForget(log.c, logRequestAsync({
    ...base,
    model: log.model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: null,
    responseBody: null,
    errorMessage: failure.rowMessage,
  }))

  return new ApiError(failure.code, failure.clientMessage, failure.details)
}

const BODY_DEADLINE = Symbol('upstream-body-deadline')

async function readBodyWithDeadline(
  opts: UpstreamFetchOptions,
  upstreamRes: Response,
  upstreamAbort: AbortController,
  fetchStartMs: number,
): Promise<string> {
  const remainingMs = Math.max(0, opts.requestStartMs + UPSTREAM_BODY_DEADLINE_MS - Date.now())
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<typeof BODY_DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(BODY_DEADLINE), remainingMs)
  })

  let outcome: string | typeof BODY_DEADLINE
  try {
    outcome = await Promise.race([upstreamRes.text(), deadline])
  } catch (err) {
    throw failUpstream(opts, fetchStartMs, describeBodyFailure(opts.provider, err), err)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }

  if (outcome === BODY_DEADLINE) {
    // Drop the upstream socket rather than leave it pinning the instance.
    upstreamAbort.abort()
    throw failUpstream(opts, fetchStartMs, describeBodyTimeout(opts.provider), undefined)
  }
  return outcome
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
    throw failUpstream(opts, startMs, describeFetchFailure(opts.provider, err), err)
  }

  clearTimeout(upstreamTimer)
  return {
    upstreamRes,
    latencyMs: Date.now() - startMs,
    proxyOverheadMs: startMs - opts.requestStartMs,
    readBodyText: () => readBodyWithDeadline(opts, upstreamRes, upstreamAbort, startMs),
  }
}
