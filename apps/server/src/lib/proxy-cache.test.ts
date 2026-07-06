import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Programmable supabaseAdmin stub — the cache module only ever touches the
// `proxy_response_cache` table via three chains:
//   .select(...).eq('key_hash', x).maybeSingle()
//   .upsert(row, { onConflict: 'key_hash' })
//   .delete().eq('key_hash', x).lt('expires_at', now)
const maybeSingleMock = vi.fn()
const upsertMock = vi.fn()
const deleteMock = vi.fn()

vi.mock('./db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (col: string, val: string) => ({
          maybeSingle: () => maybeSingleMock(table, cols, col, val),
        }),
      }),
      upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) =>
        upsertMock(table, row, opts),
      delete: () => ({
        eq: (col: string, val: string) => ({
          lt: (ltCol: string, ltVal: string) => deleteMock(table, col, val, ltCol, ltVal),
        }),
      }),
    }),
  },
  supabaseClient: {},
}))

// Keep test output clean — cache failures log via the structured logger.
vi.mock('./structured-logger.js', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}))

import {
  PROXY_CACHE_DEFAULT_TTL_SECONDS,
  PROXY_CACHE_MAX_BODY_BYTES,
  PROXY_CACHE_MAX_TTL_SECONDS,
  computeCacheKeyHash,
  deleteExpiredCacheEntry,
  parseCacheTtlSeconds,
  resolveProxyCache,
  storeCachedProxyResponse,
} from './proxy-cache.js'

const KEY_INPUT = {
  apiKeyId: 'a3f1c2d4-0000-4000-8000-000000000001',
  provider: 'openai',
  path: '/proxy/openai/v1/chat/completions',
  rawBody: '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}',
}

function freshRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    response_status: 200,
    response_body: '{"id":"chatcmpl-1","usage":{"total_tokens":15}}',
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    },
    model: 'gpt-4o-mini-2024-07-18',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  maybeSingleMock.mockReset()
  upsertMock.mockReset()
  deleteMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('parseCacheTtlSeconds — header parsing', () => {
  test('absent / null / empty header → no caching', () => {
    expect(parseCacheTtlSeconds(undefined)).toBeNull()
    expect(parseCacheTtlSeconds(null)).toBeNull()
    expect(parseCacheTtlSeconds('')).toBeNull()
    expect(parseCacheTtlSeconds('   ')).toBeNull()
  })

  test('"true" (any case, trimmed) → default TTL 3600s', () => {
    expect(parseCacheTtlSeconds('true')).toBe(PROXY_CACHE_DEFAULT_TTL_SECONDS)
    expect(parseCacheTtlSeconds('TRUE')).toBe(PROXY_CACHE_DEFAULT_TTL_SECONDS)
    expect(parseCacheTtlSeconds(' true ')).toBe(3600)
  })

  test('integer seconds pass through', () => {
    expect(parseCacheTtlSeconds('600')).toBe(600)
    expect(parseCacheTtlSeconds('1')).toBe(1)
    expect(parseCacheTtlSeconds('86400')).toBe(86400)
  })

  test('TTL is capped at 86400s', () => {
    expect(parseCacheTtlSeconds('86401')).toBe(PROXY_CACHE_MAX_TTL_SECONDS)
    expect(parseCacheTtlSeconds('999999999')).toBe(PROXY_CACHE_MAX_TTL_SECONDS)
  })

  test('anything else → no caching (fail-safe)', () => {
    expect(parseCacheTtlSeconds('false')).toBeNull()
    expect(parseCacheTtlSeconds('yes')).toBeNull()
    expect(parseCacheTtlSeconds('0')).toBeNull()
    expect(parseCacheTtlSeconds('-5')).toBeNull()
    expect(parseCacheTtlSeconds('1.5')).toBeNull()
    expect(parseCacheTtlSeconds('600s')).toBeNull()
    expect(parseCacheTtlSeconds('Infinity')).toBeNull()
  })
})

describe('computeCacheKeyHash — key stability + isolation', () => {
  test('same inputs → same 64-char hex hash (stable across calls)', async () => {
    const a = await computeCacheKeyHash(KEY_INPUT)
    const b = await computeCacheKeyHash({ ...KEY_INPUT })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  test('different api keys NEVER share a hash (cross-key isolation)', async () => {
    const a = await computeCacheKeyHash(KEY_INPUT)
    const b = await computeCacheKeyHash({
      ...KEY_INPUT,
      apiKeyId: 'a3f1c2d4-0000-4000-8000-000000000002',
    })
    expect(a).not.toBe(b)
  })

  test('provider, path, and body each change the hash', async () => {
    const base = await computeCacheKeyHash(KEY_INPUT)
    expect(await computeCacheKeyHash({ ...KEY_INPUT, provider: 'anthropic' })).not.toBe(base)
    expect(
      await computeCacheKeyHash({ ...KEY_INPUT, path: '/proxy/openai/v1/embeddings' }),
    ).not.toBe(base)
    expect(await computeCacheKeyHash({ ...KEY_INPUT, rawBody: '{"model":"gpt-4o"}' })).not.toBe(
      base,
    )
  })
})

describe('resolveProxyCache — decision matrix', () => {
  test('header absent → mode off, no DB lookup', async () => {
    const result = await resolveProxyCache({
      ...KEY_INPUT,
      cacheHeader: undefined,
      isStreaming: false,
    })
    expect(result.state.mode).toBe('off')
    expect(result.expiredKeyHash).toBeNull()
    expect(maybeSingleMock).not.toHaveBeenCalled()
  })

  test('malformed header → mode off (never caches by accident)', async () => {
    const result = await resolveProxyCache({
      ...KEY_INPUT,
      cacheHeader: 'please',
      isStreaming: false,
    })
    expect(result.state.mode).toBe('off')
    expect(maybeSingleMock).not.toHaveBeenCalled()
  })

  test('stream:true bypasses the cache entirely (no DB lookup)', async () => {
    const result = await resolveProxyCache({
      ...KEY_INPUT,
      cacheHeader: 'true',
      isStreaming: true,
    })
    expect(result.state.mode).toBe('bypass')
    expect(maybeSingleMock).not.toHaveBeenCalled()
  })

  test('no row → miss with keyHash + ttl', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null })
    const result = await resolveProxyCache({
      ...KEY_INPUT,
      cacheHeader: '120',
      isStreaming: false,
    })
    expect(result.state).toEqual({
      mode: 'miss',
      keyHash: await computeCacheKeyHash(KEY_INPUT),
      ttlSeconds: 120,
    })
    expect(result.expiredKeyHash).toBeNull()
    // Lookup keyed on key_hash against the cache table.
    const [table, , col, val] = maybeSingleMock.mock.calls[0] ?? []
    expect(table).toBe('proxy_response_cache')
    expect(col).toBe('key_hash')
    expect(val).toBe(await computeCacheKeyHash(KEY_INPUT))
  })

  test('fresh row → hit with numeric usage (jsonb values coerced via Number)', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: freshRow({
        // Simulate string-typed values sneaking through jsonb.
        usage: { prompt_tokens: '10', completion_tokens: '5', total_tokens: '15' },
      }),
      error: null,
    })
    const result = await resolveProxyCache({
      ...KEY_INPUT,
      cacheHeader: 'true',
      isStreaming: false,
    })
    expect(result.state.mode).toBe('hit')
    if (result.state.mode !== 'hit') return
    expect(result.state.entry.responseStatus).toBe(200)
    expect(result.state.entry.model).toBe('gpt-4o-mini-2024-07-18')
    expect(result.state.entry.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    })
  })

  test('expired row → miss + expiredKeyHash set for opportunistic cleanup', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: freshRow({ expires_at: new Date(Date.now() - 1_000).toISOString() }),
      error: null,
    })
    const result = await resolveProxyCache({
      ...KEY_INPUT,
      cacheHeader: 'true',
      isStreaming: false,
    })
    expect(result.state.mode).toBe('miss')
    expect(result.expiredKeyHash).toBe(await computeCacheKeyHash(KEY_INPUT))
  })

  test('lookup error fails OPEN as a miss (cache outage never breaks the proxy)', async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: 'db down' } })
    const result = await resolveProxyCache({
      ...KEY_INPUT,
      cacheHeader: 'true',
      isStreaming: false,
    })
    expect(result.state.mode).toBe('miss')
    expect(result.expiredKeyHash).toBeNull()
  })

  test('lookup throw fails OPEN as a miss', async () => {
    maybeSingleMock.mockRejectedValueOnce(new Error('network blip'))
    const result = await resolveProxyCache({
      ...KEY_INPUT,
      cacheHeader: 'true',
      isStreaming: false,
    })
    expect(result.state.mode).toBe('miss')
  })
})

describe('storeCachedProxyResponse — write guards', () => {
  const STORE_INPUT = {
    keyHash: 'k'.repeat(64),
    apiKeyId: KEY_INPUT.apiKeyId,
    provider: 'openai',
    ttlSeconds: 600,
    responseStatus: 200,
    responseBody: '{"id":"chatcmpl-1"}',
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    },
    model: 'gpt-4o-mini',
  }

  test('stores a 200 JSON response with expires_at = now + ttl', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T12:00:00Z'))
    upsertMock.mockResolvedValueOnce({ error: null })

    await storeCachedProxyResponse(STORE_INPUT)

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const [table, row, opts] = upsertMock.mock.calls[0] ?? []
    expect(table).toBe('proxy_response_cache')
    expect(opts).toEqual({ onConflict: 'key_hash' })
    expect(row).toMatchObject({
      key_hash: STORE_INPUT.keyHash,
      api_key_id: STORE_INPUT.apiKeyId,
      provider: 'openai',
      response_status: 200,
      response_body: STORE_INPUT.responseBody,
      model: 'gpt-4o-mini',
    })
    expect(row.expires_at).toBe(new Date('2026-07-06T12:10:00Z').toISOString())
  })

  test('non-200 responses are never stored', async () => {
    await storeCachedProxyResponse({ ...STORE_INPUT, responseStatus: 401 })
    await storeCachedProxyResponse({ ...STORE_INPUT, responseStatus: 500 })
    expect(upsertMock).not.toHaveBeenCalled()
  })

  test('bodies over 256 KB are never stored', async () => {
    const bigBody = `{"pad":"${'x'.repeat(PROXY_CACHE_MAX_BODY_BYTES)}"}`
    await storeCachedProxyResponse({ ...STORE_INPUT, responseBody: bigBody })
    expect(upsertMock).not.toHaveBeenCalled()
  })

  test('a body exactly at the limit IS stored', async () => {
    upsertMock.mockResolvedValueOnce({ error: null })
    const exactBody = 'x'.repeat(PROXY_CACHE_MAX_BODY_BYTES)
    await storeCachedProxyResponse({ ...STORE_INPUT, responseBody: exactBody })
    expect(upsertMock).toHaveBeenCalledTimes(1)
  })

  test('upsert error / throw never propagates (fireAndForget-safe)', async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: 'db down' } })
    await expect(storeCachedProxyResponse(STORE_INPUT)).resolves.toBeUndefined()

    upsertMock.mockRejectedValueOnce(new Error('network blip'))
    await expect(storeCachedProxyResponse(STORE_INPUT)).resolves.toBeUndefined()
  })
})

describe('deleteExpiredCacheEntry — opportunistic cleanup', () => {
  test('deletes only rows still expired (lt expires_at guard)', async () => {
    deleteMock.mockResolvedValueOnce({ error: null })
    await deleteExpiredCacheEntry('hash-1')

    expect(deleteMock).toHaveBeenCalledTimes(1)
    const [table, col, val, ltCol, ltVal] = deleteMock.mock.calls[0] ?? []
    expect(table).toBe('proxy_response_cache')
    expect(col).toBe('key_hash')
    expect(val).toBe('hash-1')
    expect(ltCol).toBe('expires_at')
    // Guard timestamp must be a valid ISO string near "now" so a concurrently
    // refreshed row is never deleted.
    expect(new Date(ltVal as string).getTime()).toBeGreaterThan(0)
  })

  test('delete error / throw never propagates (fireAndForget-safe)', async () => {
    deleteMock.mockResolvedValueOnce({ error: { message: 'db down' } })
    await expect(deleteExpiredCacheEntry('hash-1')).resolves.toBeUndefined()

    deleteMock.mockRejectedValueOnce(new Error('network blip'))
    await expect(deleteExpiredCacheEntry('hash-1')).resolves.toBeUndefined()
  })
})
