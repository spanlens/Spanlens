import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { drainPendingTasks, geminiResponse, mockUpstream, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * End-to-end integration tests for the Gemini proxy. Gemini's wire protocol
 * is uniquely query-param-based — the API key rides in `?key=...` on the URL,
 * not in a header. The handler-specific contract:
 *   1. Decrypted provider key is placed in `?key=` on the upstream URL.
 *   2. Any incoming `?key=` from the caller is OVERWRITTEN (the proxy's
 *      decrypted key wins — a caller can't smuggle their own credential).
 *   3. Authorization header (if present) is deleted before upstream.
 *   4. Other query params (e.g. `?alt=sse`) are preserved.
 *   5. Model name is extracted from the URL path (`/models/<model>:<op>`),
 *      not the request body.
 *   6. Token usage shape is camelCase (`promptTokenCount` etc).
 */

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
  requireFullScope: (async (_c: Context, next: Next) => {
    if (proxyState.scope === 'public') {
      const { ApiError } = await import('../lib/errors.js')
      throw new ApiError('PUBLIC_KEY_WRITE_FORBIDDEN', 'Public API key cannot write')
    }
    await next()
  }) as MiddlewareHandler,
}))

vi.mock('../middleware/rateLimit.js', () => ({
  proxyRateLimit: (async (_c: Context, next: Next) => { await next() }) as MiddlewareHandler,
}))

vi.mock('../middleware/quota.js', () => ({
  enforceQuota: (async (_c: Context, next: Next) => { await next() }) as MiddlewareHandler,
}))

vi.mock('../proxy/utils.js', async () => {
  const actual = await vi.importActual<typeof import('../proxy/utils.js')>(
    '../proxy/utils.js',
  )
  return {
    ...actual,
    getDecryptedProviderKey: vi.fn(async () => {
      if (proxyState.decryptedKey === '') return null
      return {
        plaintext: proxyState.decryptedKey,
        id: proxyState.providerKeyId,
        metadata: {},
      }
    }),
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

async function buildApp() {
  const { Hono } = await import('hono')
  const { geminiProxy } = await import('../proxy/gemini.js')
  const app = new Hono()
  app.route('/proxy/gemini', geminiProxy)
  installOnError(app)
  return app
}

beforeEach(() => {
  resetProxyMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('gemini proxy — query-param key handling (security critical)', () => {
  test('decrypted provider key is placed in ?key= on the upstream URL', async () => {
    proxyState.decryptedKey = 'AIza-real-gemini-key-xyz'
    mockUpstream(geminiResponse())
    const app = await buildApp()

    await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    })
    await drainPendingTasks()

    const upstreamUrl = new URL(proxyState.fetchCalls[0]!.url)
    expect(upstreamUrl.searchParams.get('key')).toBe('AIza-real-gemini-key-xyz')
  })

  test("caller's incoming ?key=... is overwritten with our decrypted key (no smuggling)", async () => {
    proxyState.decryptedKey = 'AIza-real-server-key'
    mockUpstream(geminiResponse())
    const app = await buildApp()

    await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent?key=AIza-attacker-supplied', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    })
    await drainPendingTasks()

    const upstreamUrl = new URL(proxyState.fetchCalls[0]!.url)
    expect(upstreamUrl.searchParams.get('key')).toBe('AIza-real-server-key')
    expect(upstreamUrl.searchParams.get('key')).not.toContain('attacker')
  })

  test('other query params (alt=sse) are preserved on the upstream URL', async () => {
    mockUpstream(geminiResponse())
    const app = await buildApp()

    await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent?alt=sse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    })
    await drainPendingTasks()

    const upstreamUrl = new URL(proxyState.fetchCalls[0]!.url)
    expect(upstreamUrl.searchParams.get('alt')).toBe('sse')
  })

  test('any Authorization header from the caller is deleted before upstream', async () => {
    mockUpstream(geminiResponse())
    const app = await buildApp()

    await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sl_live_should_not_appear',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contents: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.fetchCalls[0]!.headers.get('authorization')).toBeNull()
  })

  test('x-spanlens-* headers stripped before reaching upstream', async () => {
    mockUpstream(geminiResponse())
    const app = await buildApp()

    await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spanlens-user': 'usr_internal',
      },
      body: JSON.stringify({ contents: [] }),
    })
    await drainPendingTasks()

    proxyState.fetchCalls[0]!.headers.forEach((_v, k) => {
      expect(k.toLowerCase().startsWith('x-spanlens-')).toBe(false)
    })
  })

  test('upstream URL strips the /proxy/gemini prefix correctly', async () => {
    mockUpstream(geminiResponse())
    const app = await buildApp()

    await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    })
    await drainPendingTasks()

    const u = new URL(proxyState.fetchCalls[0]!.url)
    expect(u.origin).toBe('https://generativelanguage.googleapis.com')
    expect(u.pathname).toBe('/v1/models/gemini-1.5-pro:generateContent')
  })
})

describe('gemini proxy — provider key + scope guards', () => {
  test('NO_PROVIDER_KEY 400 with provider:"gemini" detail', async () => {
    proxyState.decryptedKey = ''
    const app = await buildApp()

    const res = await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; details: { provider: string } } }
    expect(body.error.code).toBe('NO_PROVIDER_KEY')
    expect(body.error.details.provider).toBe('gemini')
    expect(proxyState.fetchCalls).toHaveLength(0)
  })

  test('public-scope key returns 403 PUBLIC_KEY_WRITE_FORBIDDEN', async () => {
    proxyState.scope = 'public'
    const app = await buildApp()

    const res = await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent', {
      method: 'POST',
      body: JSON.stringify({ contents: [] }),
    })

    expect(res.status).toBe(403)
    expect(proxyState.fetchCalls).toHaveLength(0)
  })
})

describe('gemini proxy — model extraction + logging', () => {
  test('model is extracted from URL path, not body, and forwarded to log row', async () => {
    mockUpstream(geminiResponse({ model: 'gemini-1.5-pro', promptTokens: 12, completionTokens: 4 }))
    const app = await buildApp()

    await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.loggerCalls).toHaveLength(1)
    const row = proxyState.loggerCalls[0]!
    expect(row['provider']).toBe('gemini')
    expect(row['model']).toBe('gemini-1.5-pro')
    expect(row['promptTokens']).toBe(12)
    expect(row['completionTokens']).toBe(4)
    expect(row['totalTokens']).toBe(16)
    expect(row['providerKeyId']).toBe(proxyState.providerKeyId)
  })

  test('upstream error status passes through and is recorded', async () => {
    mockUpstream(new Response(
      JSON.stringify({ error: { code: 401, message: 'API key not valid' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ))
    const app = await buildApp()

    const res = await app.request('/proxy/gemini/v1/models/gemini-1.5-pro:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(401)
    expect(proxyState.loggerCalls[0]!['statusCode']).toBe(401)
    expect((proxyState.loggerCalls[0]!['errorMessage'] as string)).toContain('API key not valid')
  })
})
