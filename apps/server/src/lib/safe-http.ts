/**
 * POST to a customer-supplied URL with the SSRF guard applied to every hop
 * and to every connection. Today the only caller is lib/webhook-dispatch.ts.
 *
 * A plain `fetch(url, { method: 'POST' })` after `validateOutboundUrl(url)`
 * leaves two holes, both reproduced against real sockets (XVERIFY C12.5):
 *
 *   1. Redirects. fetch follows 3xx by default and only the first URL had
 *      been validated. An allowed https endpoint could answer
 *      `307 Location: http://127.0.0.1:8080/admin` and Spanlens would POST
 *      the signed body there, then report the internal service's status code
 *      back through /api/v1/webhooks/:id/test. Here every Location is
 *      resolved, run through the validator (https only, deny-listed
 *      hostnames and address ranges), and followed at most MAX_REDIRECTS
 *      times.
 *   2. DNS rebinding. The validator's DNS query and the connection's DNS
 *      query are separate, and an attacker's DNS server can answer them
 *      differently. Every connection here resolves through `guardedLookup`,
 *      so the address that is checked is the address that is dialled.
 *
 * Redirects keep the method, body and headers (signature and delivery id
 * included) on every status, 301/302/303 as well as 307/308. A webhook is a
 * POST; turning it into a bodiless GET, as browsers do, would record a
 * delivery as successful when the event never arrived.
 *
 * Node runtime only (node:http / node:https). apps/server runs on Node both
 * on Vercel (api/index.ts `runtime = 'nodejs'`) and in the Docker image.
 * Sockets are never pooled (`agent: false`), so a connection opened outside
 * this module can never be reused by a request that relies on the guard.
 */

import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { guardedLookup, validateOutboundUrl, type SafeUrlResult } from './safe-url.js'

/** Redirect hops followed before the attempt is failed. */
export const MAX_REDIRECTS = 3

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface SafePostOptions {
  headers: Readonly<Record<string, string>>
  body: string
  /** Budget for the whole exchange: every hop's validation, DNS and request. */
  timeoutMs: number
  maxRedirects?: number
  /** Per-hop URL check. Tests inject one; production uses validateOutboundUrl. */
  validate?: (url: string) => Promise<SafeUrlResult>
}

export interface SafePostResult {
  /** Status of the last response received, or null when none arrived. */
  status: number | null
  /** Why the exchange stopped short of a final response, or null. */
  error: string | null
}

interface HopResponse {
  status: number
  location: string | null
}

/** Rejects with the signal's reason as soon as it aborts. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

function locationOf(res: IncomingMessage): string | null {
  const value = res.headers.location
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** One request, no redirect handling. Resolves on the response headers. */
function postOnce(
  target: URL,
  headers: Readonly<Record<string, string>>,
  body: string,
  signal: AbortSignal,
): Promise<HopResponse> {
  const send = target.protocol === 'http:' ? httpRequest : httpsRequest
  return new Promise<HopResponse>((resolve, reject) => {
    const req = send(
      target,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        agent: false,
        lookup: guardedLookup,
        signal,
      },
      (res) => {
        // The body is never read or stored; drain it so the socket closes.
        res.resume()
        resolve({ status: res.statusCode ?? 0, location: locationOf(res) })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

function describeFailure(err: unknown, signal: AbortSignal, timeoutMs: number): string {
  if (signal.aborted) return `Request timed out after ${timeoutMs}ms`
  return err instanceof Error ? err.message : 'Request failed'
}

function nextHop(location: string, current: string): string | null {
  try {
    return new URL(location, current).toString()
  } catch {
    return null
  }
}

/**
 * POSTs `body` to `url`, following up to `maxRedirects` redirects, each one
 * validated before it is dialled. Never throws: every failure comes back as
 * `error`, alongside the last status received if there was one.
 */
export async function safePost(url: string, options: SafePostOptions): Promise<SafePostResult> {
  const validate = options.validate ?? validateOutboundUrl
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS
  const signal = AbortSignal.timeout(options.timeoutMs)

  let target = url
  let lastStatus: number | null = null
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const check = await abortable(validate(target), signal)
      if (!check.ok) {
        const error =
          hop === 0
            ? `URL rejected by SSRF guard: ${check.message}`
            : `Redirect to ${new URL(target).host} rejected by SSRF guard: ${check.message}`
        return { status: lastStatus, error }
      }

      const res = await postOnce(new URL(target), options.headers, options.body, signal)
      lastStatus = res.status
      if (!REDIRECT_STATUSES.has(res.status) || res.location === null) {
        return { status: res.status, error: null }
      }

      const next = nextHop(res.location, target)
      if (next === null) {
        return { status: res.status, error: 'Redirect Location header is not a valid URL' }
      }
      target = next
    }
    return { status: lastStatus, error: `Too many redirects (more than ${maxRedirects})` }
  } catch (err) {
    return { status: lastStatus, error: describeFailure(err, signal, options.timeoutMs) }
  }
}
