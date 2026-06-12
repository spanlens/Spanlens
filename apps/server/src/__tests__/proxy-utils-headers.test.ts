import { describe, expect, test } from 'vitest'
import { buildUpstreamHeaders, buildDownstreamHeaders } from '../proxy/utils.js'

/**
 * proxy/utils.ts header rewriting is shared by all 4 proxy handlers
 * (openai / anthropic / gemini / azure). A regression here can:
 *   (1) leak the customer's Spanlens API key upstream (Authorization not stripped),
 *   (2) forward `x-spanlens-*` internal metadata to OpenAI/Anthropic — violates
 *       the CLAUDE.md "X-Spanlens-* never leaves the proxy" contract,
 *   (3) ship a stale content-length so undici rejects the request, or
 *   (4) return content-encoding to the client for an already-decoded body.
 *
 * These are exactly the failure modes the unit tests below pin down.
 */

function headersFromObject(obj: Record<string, string>): Headers {
  const h = new Headers()
  for (const [k, v] of Object.entries(obj)) h.set(k, v)
  return h
}

describe('buildUpstreamHeaders — sensitive header stripping', () => {
  test('strips the incoming Authorization header (customer Spanlens key never leaks upstream)', () => {
    const incoming = headersFromObject({
      Authorization: 'Bearer sl_live_customerkey123',
      'Content-Type': 'application/json',
    })
    const out = buildUpstreamHeaders(incoming, {
      Authorization: 'Bearer sk-real-openai-key',
    })
    expect(out.get('Authorization')).toBe('Bearer sk-real-openai-key')
    expect(out.get('Authorization')).not.toContain('sl_live_')
  })

  test('overrides win over incoming (case-insensitive in HTTP Headers)', () => {
    const incoming = headersFromObject({ 'Content-Type': 'text/plain' })
    const out = buildUpstreamHeaders(incoming, {
      'content-type': 'application/json',
    })
    expect(out.get('content-type')).toBe('application/json')
  })

  test('strips hop-by-hop + length-related headers (host, connection, content-length, transfer-encoding, te, upgrade)', () => {
    const incoming = headersFromObject({
      host: 'api.spanlens.io',
      connection: 'keep-alive',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      'content-length': '12345',
      te: 'trailers',
      upgrade: 'websocket',
      'proxy-authorization': 'Basic xxx',
      'proxy-connection': 'keep-alive',
    })
    const out = buildUpstreamHeaders(incoming, {})
    for (const name of [
      'host',
      'connection',
      'keep-alive',
      'transfer-encoding',
      'content-length',
      'te',
      'upgrade',
      'proxy-authorization',
      'proxy-connection',
    ]) {
      expect(out.get(name), `expected ${name} to be stripped`).toBeNull()
    }
  })

  test('strips every x-spanlens-* header (internal metadata never reaches upstream)', () => {
    const incoming = headersFromObject({
      'x-spanlens-project': 'proj_123',
      'x-spanlens-prompt-version': 'greeter@3',
      'x-spanlens-user': 'usr_456',
      'x-spanlens-session': 'sess_789',
      'x-spanlens-log-body': 'meta',
      'X-Spanlens-Custom': 'mixed-case-still-stripped',
      'Content-Type': 'application/json',
    })
    const out = buildUpstreamHeaders(incoming, {})
    // Iterate to confirm none of the x-spanlens-* survived
    const surviving: string[] = []
    out.forEach((_v, k) => {
      if (k.toLowerCase().startsWith('x-spanlens-')) surviving.push(k)
    })
    expect(surviving).toEqual([])
    // Content-Type still passes through
    expect(out.get('content-type')).toBe('application/json')
  })

  test('passes through innocuous headers untouched (user-agent, accept, custom non-spanlens)', () => {
    const incoming = headersFromObject({
      'user-agent': 'spanlens-sdk/0.6.1',
      accept: 'application/json',
      'x-request-id': 'req_abc',
    })
    const out = buildUpstreamHeaders(incoming, {})
    expect(out.get('user-agent')).toBe('spanlens-sdk/0.6.1')
    expect(out.get('accept')).toBe('application/json')
    expect(out.get('x-request-id')).toBe('req_abc')
  })

  test('strips Authorization even when only override provides replacement (defense in depth)', () => {
    // Without the override, Authorization should still be removed —
    // a misconfigured proxy must never accidentally forward the user key.
    const incoming = headersFromObject({
      authorization: 'Bearer sl_live_leak_me',
    })
    const out = buildUpstreamHeaders(incoming, {})
    expect(out.get('authorization')).toBeNull()
  })

  test('empty incoming + empty overrides → empty output (no defaults injected)', () => {
    const out = buildUpstreamHeaders(new Headers(), {})
    let count = 0
    out.forEach(() => count++)
    expect(count).toBe(0)
  })
})

describe('buildDownstreamHeaders — response header stripping', () => {
  test('strips content-encoding (body has already been decoded by fetch)', () => {
    // gotcha: undici/fetch returns the decoded body but the upstream response
    // still says `content-encoding: gzip`. If we forward that header the
    // browser tries to decompress an already-decompressed body → corrupt.
    const upstream = headersFromObject({
      'content-encoding': 'gzip',
      'content-type': 'application/json',
    })
    const out = buildDownstreamHeaders(upstream)
    expect(out.get('content-encoding')).toBeNull()
    expect(out.get('content-type')).toBe('application/json')
  })

  test('strips hop-by-hop headers from response (connection, keep-alive, transfer-encoding, te)', () => {
    const upstream = headersFromObject({
      connection: 'close',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      te: 'trailers',
      'x-request-id': 'upstream-req-id',
    })
    const out = buildDownstreamHeaders(upstream)
    expect(out.get('connection')).toBeNull()
    expect(out.get('keep-alive')).toBeNull()
    expect(out.get('transfer-encoding')).toBeNull()
    expect(out.get('te')).toBeNull()
    // Non-hop-by-hop passes through so callers can correlate requests
    expect(out.get('x-request-id')).toBe('upstream-req-id')
  })

  test('preserves rate-limit + provider-specific headers (so SDKs can see them)', () => {
    const upstream = headersFromObject({
      'x-ratelimit-limit-requests': '500',
      'x-ratelimit-remaining-requests': '499',
      'openai-organization': 'org-abc',
      'anthropic-ratelimit-tokens-remaining': '12345',
    })
    const out = buildDownstreamHeaders(upstream)
    expect(out.get('x-ratelimit-limit-requests')).toBe('500')
    expect(out.get('x-ratelimit-remaining-requests')).toBe('499')
    expect(out.get('openai-organization')).toBe('org-abc')
    expect(out.get('anthropic-ratelimit-tokens-remaining')).toBe('12345')
  })
})
