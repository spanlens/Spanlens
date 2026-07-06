import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { drainPendingTasks, mockUpstream, openAIChatResponse, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * Integration tests for the opt-in response cache (x-spanlens-cache header)
 * wired through the OpenAI proxy handler. Follows the proxy-openai.test.ts
 * harness: middleware no-op'd, upstream fetch spied, fireAndForget queued into
 * proxyState.pendingTasks, and — new here — supabaseAdmin replaced with an
 * in-memory Map backing the `proxy_response_cache` table so the real
 * lib/proxy-cache.ts read/write paths execute end to end.
 *
 * Contract pinned:
 *   1. MISS: upstream called, `x-spanlens-cache: miss` on the response, row
 *      stored with expires_at.
 *   2. HIT: identical request served WITHOUT calling upstream, byte-identical
 *      body, `x-spanlens-cache: hit`, logged with cacheHit=true + costUsd=0
 *      and the ORIGINAL token counts.
 *   3. No header → no caching, no cache response header.
 *   4. stream:true + header → `x-spanlens-cache: bypass`, nothing stored.
 *   5. Different Spanlens key → the cached entry is NOT shared (security).
 */

// === In-memory proxy_response_cache store ==================================

const cacheStore = new Map<string, Record<string, unknown>>()

vi.mock('../lib/db.js', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== 'proxy_response_cache') {
        throw new Error(`unexpected table in proxy-cache integration test: ${table}`)
      }
      return {
        select: () => ({
          eq: (_col: string, keyHash: string) => ({
            maybeSingle: async () => ({ data: cacheStore.get(keyHash) ?? null, error: null }),
          }),
        }),
        upsert: async (row: Record<string, unknown>) => {
          cacheStore.set(row['key_hash'] as string, row)
          return { error: null }
        },
        delete: () => ({
          eq: (_col: string, keyHash: string) => ({
            lt: async () => {
              cacheStore.delete(keyHash)
              return { error: null }
            },
          }),
        }),
      }
    },
  },
  supabaseClient: {},
}))

// === Standard proxy harness mocks (same shape as proxy-openai.test.ts) =====

vi.mock('../middleware/authApiKey.js', async () => {
  const actual = await vi.importActual<typeof import('../middleware/authApiKey.js')>(
    '../middleware/authApiKey.js',
  )
  return {
    ...actual,
    authApiKey: (async (c: Context, next: Next) => {
      c.set('apiKeyId', proxyState.apiKeyId)
      c.set('organizationId', proxyState.organizationId)
      c.set('projectId', proxyState.projectId)
      c.set('apiKeyScope', proxyState.scope)
      await next()
    }) as MiddlewareHandler,
  }
})

vi.mock('../middleware/requireFullScope.js', () => ({
  requireFullScope: (async (_c: Context, next: Next) => { await next() }) as MiddlewareHandler,
}))

vi.mock('../middleware/rateLimit.js', () => ({
  proxyRateLimit: (async (_c: Context, next: Next) => { await next() }) as MiddlewareHandler,
}))

vi.mock('../middleware/quota.js', () => ({
  enforceQuota: (async (_c: Context, next: Next) => { await next() }) as MiddlewareHandler,
}))

vi.mock('../middleware/customerRateLimit.js', () => ({
  customerRateLimit: (async (_c: Context, next: Next) => { await next() }) as MiddlewareHandler,
}))

vi.mock('../proxy/utils.js', async () => {
  const actual = await vi.importActual<typeof import('../proxy/utils.js')>(
    '../proxy/utils.js',
  )
  return {
    ...actual,
    getDecryptedProviderKey: vi.fn(async () => ({
      plaintext: proxyState.decryptedKey,
      id: proxyState.providerKeyId,
      metadata: {},
    })),
    isBlockingEnabled: vi.fn(async () => proxyState.blockingEnabled),
  }
})

vi.mock('../lib/logger.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/logger.js')>(
    '../lib/logger.js',
  )
  return {
    ...actual,
    logRequestAsync: vi.fn(async (data: Record<string, unknown>) => {
      proxyState.loggerCalls.push(data)
    }),
  }
})

vi.mock('../lib/resolve-prompt-version.js', () => ({
  resolvePromptVersion: vi.fn(async () => null),
}))

vi.mock('../lib/wait-until.js', () => ({
  fireAndForget: (_c: Context, promise: Promise<unknown>) => {
    proxyState.pendingTasks.push(promise.catch(() => undefined))
  },
}))

// === App harness ===========================================================

async function buildApp() {
  const { Hono } = await import('hono')
  const { openaiProxy } = await import('../proxy/openai.js')
  const app = new Hono()
  app.route('/proxy/openai', openaiProxy)
  installOnError(app)
  return app
}

const CHAT_BODY = JSON.stringify({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hi' }],
})

function chatRequest(app: Awaited<ReturnType<typeof buildApp>>, headers: Record<string, string> = {}, body: string = CHAT_BODY) {
  return app.request('/proxy/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
}

// === Tests =================================================================

beforeEach(() => {
  resetProxyMocks()
  cacheStore.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('openai proxy — response cache miss → hit', () => {
  test('first request is a miss (stored), identical second request is a hit that skips upstream', async () => {
    mockUpstream(openAIChatResponse({ model: 'gpt-4o-mini-2024-07-18', promptTokens: 10, completionTokens: 5 }))
    const app = await buildApp()

    // ── First request: MISS ──────────────────────────────────────────────
    const miss = await chatRequest(app, { 'x-spanlens-cache': 'true' })
    await drainPendingTasks()

    expect(miss.status).toBe(200)
    expect(miss.headers.get('x-spanlens-cache')).toBe('miss')
    expect(proxyState.fetchCalls).toHaveLength(1)
    expect(cacheStore.size).toBe(1)
    const missBody = await miss.text()

    const storedRow = [...cacheStore.values()][0]!
    expect(storedRow['api_key_id']).toBe(proxyState.apiKeyId)
    expect(storedRow['provider']).toBe('openai')
    expect(storedRow['response_body']).toBe(missBody)
    expect(new Date(storedRow['expires_at'] as string).getTime()).toBeGreaterThan(Date.now())

    const missLog = proxyState.loggerCalls[0]!
    expect(missLog['cacheHit']).toBeUndefined()
    expect(missLog['costUsd']).not.toBe(0)

    // ── Second identical request: HIT ────────────────────────────────────
    proxyState.loggerCalls = []
    const hit = await chatRequest(app, { 'x-spanlens-cache': 'true' })
    await drainPendingTasks()

    expect(hit.status).toBe(200)
    expect(hit.headers.get('x-spanlens-cache')).toBe('hit')
    expect(hit.headers.get('content-type')).toBe('application/json')
    // Upstream was NOT called again.
    expect(proxyState.fetchCalls).toHaveLength(1)
    // Byte-identical body.
    expect(await hit.text()).toBe(missBody)

    // The hit is still logged — with the cached tokens, zero cost, cacheHit.
    expect(proxyState.loggerCalls).toHaveLength(1)
    const hitLog = proxyState.loggerCalls[0]!
    expect(hitLog['cacheHit']).toBe(true)
    expect(hitLog['costUsd']).toBe(0)
    expect(hitLog['model']).toBe('gpt-4o-mini-2024-07-18')
    expect(hitLog['promptTokens']).toBe(10)
    expect(hitLog['completionTokens']).toBe(5)
    expect(hitLog['totalTokens']).toBe(15)
    expect(hitLog['statusCode']).toBe(200)
  })

  test('a different Spanlens key does NOT see the cached entry (cross-key isolation)', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await chatRequest(app, { 'x-spanlens-cache': 'true' })
    await drainPendingTasks()
    expect(proxyState.fetchCalls).toHaveLength(1)

    // Same request, different authenticated key → must go upstream again.
    proxyState.apiKeyId = 'key_other_tenant'
    const res = await chatRequest(app, { 'x-spanlens-cache': 'true' })
    await drainPendingTasks()

    expect(res.headers.get('x-spanlens-cache')).toBe('miss')
    expect(proxyState.fetchCalls).toHaveLength(2)
    expect(cacheStore.size).toBe(2)
  })

  test('a different request body does not hit the cached entry (exact match)', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await chatRequest(app, { 'x-spanlens-cache': 'true' })
    await drainPendingTasks()

    const otherBody = JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'bye' }] })
    const res = await chatRequest(app, { 'x-spanlens-cache': 'true' }, otherBody)
    await drainPendingTasks()

    expect(res.headers.get('x-spanlens-cache')).toBe('miss')
    expect(proxyState.fetchCalls).toHaveLength(2)
  })
})

describe('openai proxy — response cache opt-in gating', () => {
  test('without the header nothing is cached and no cache response header appears', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    const res = await chatRequest(app)
    await drainPendingTasks()

    expect(res.status).toBe(200)
    expect(res.headers.get('x-spanlens-cache')).toBeNull()
    expect(cacheStore.size).toBe(0)
  })

  test('malformed header value is treated as off', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    const res = await chatRequest(app, { 'x-spanlens-cache': 'forever' })
    await drainPendingTasks()

    expect(res.headers.get('x-spanlens-cache')).toBeNull()
    expect(cacheStore.size).toBe(0)
  })

  test('stream:true bypasses the cache — header answers "bypass", nothing stored', async () => {
    const sse = [
      'data: {"id":"chatcmpl-s","choices":[{"delta":{"content":"hi"}}]}',
      'data: [DONE]',
      '',
    ].join('\n')
    mockUpstream(new Response(sse, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    const app = await buildApp()

    const res = await chatRequest(
      app,
      { 'x-spanlens-cache': 'true' },
      JSON.stringify({ model: 'gpt-4o-mini', stream: true, messages: [] }),
    )
    await res.text() // drain the stream so the pump completes
    await drainPendingTasks()

    expect(res.headers.get('x-spanlens-cache')).toBe('bypass')
    expect(cacheStore.size).toBe(0)
  })

  test('upstream errors are never cached', async () => {
    mockUpstream(new Response(JSON.stringify({ error: { message: 'boom' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    }))
    const app = await buildApp()

    const res = await chatRequest(app, { 'x-spanlens-cache': 'true' })
    await drainPendingTasks()

    expect(res.status).toBe(500)
    expect(res.headers.get('x-spanlens-cache')).toBe('miss')
    expect(cacheStore.size).toBe(0)
  })

  test('the x-spanlens-cache request header never reaches upstream', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    await chatRequest(app, { 'x-spanlens-cache': 'true' })
    await drainPendingTasks()

    const sent = proxyState.fetchCalls[0]!
    expect(sent.headers.get('x-spanlens-cache')).toBeNull()
  })
})

describe('openai proxy — expired cache entries', () => {
  test('an expired row is a miss and gets cleaned up opportunistically', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    // Seed via a real miss, then force-expire the stored row.
    await chatRequest(app, { 'x-spanlens-cache': 'true' })
    await drainPendingTasks()
    const [keyHash, row] = [...cacheStore.entries()][0]!
    cacheStore.set(keyHash, { ...row, expires_at: new Date(Date.now() - 1_000).toISOString() })

    const res = await chatRequest(app, { 'x-spanlens-cache': 'true' })
    await drainPendingTasks()

    expect(res.headers.get('x-spanlens-cache')).toBe('miss')
    expect(proxyState.fetchCalls).toHaveLength(2)
    // The second miss re-stored a fresh row (cleanup delete + upsert both ran).
    const refreshed = cacheStore.get(keyHash)!
    expect(new Date(refreshed['expires_at'] as string).getTime()).toBeGreaterThan(Date.now())
  })
})
