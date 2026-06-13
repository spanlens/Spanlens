import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { drainPendingTasks, mockUpstream, openAIChatResponse, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * Integration tests for the Mistral proxy. The Mistral API is
 * OpenAI-compatible end-to-end, so the proxy reuses the OpenAI parser
 * and stream logger — these tests pin the Mistral-specific contract:
 *   1. Upstream URL is built from MISTRAL_API_BASE (default api.mistral.ai)
 *      and forwards `/proxy/mistral/...` after stripping the prefix.
 *   2. Authorization header carries the decrypted Mistral key, not the
 *      customer Spanlens key.
 *   3. The log row carries provider='mistral' so the dashboard can
 *      group by it, and cost is calculated via the new pricing seed.
 *   4. Public-scope key + NO_PROVIDER_KEY paths return the same 403/400
 *      codes as the other proxy handlers (consistency).
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
  const { mistralProxy } = await import('../proxy/mistral.js')
  const app = new Hono()
  app.route('/proxy/mistral', mistralProxy)
  installOnError(app)
  return app
}

beforeEach(() => {
  resetProxyMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('mistral proxy — auth + URL building', () => {
  test('upstream URL = api.mistral.ai + path with /proxy/mistral stripped', async () => {
    mockUpstream(openAIChatResponse({ model: 'mistral-small-latest' }))
    const app = await buildApp()

    await app.request('/proxy/mistral/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistral-small-latest', messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.fetchCalls[0]!.url).toBe('https://api.mistral.ai/v1/chat/completions')
  })

  test('upstream Authorization carries decrypted Mistral key (not customer sl_live_*)', async () => {
    proxyState.decryptedKey = 'mistral-real-key-abc'
    mockUpstream(openAIChatResponse({ model: 'mistral-large-latest' }))
    const app = await buildApp()

    await app.request('/proxy/mistral/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sl_live_customer_must_not_leak',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'mistral-large-latest', messages: [] }),
    })
    await drainPendingTasks()

    const sent = proxyState.fetchCalls[0]!
    expect(sent.headers.get('authorization')).toBe('Bearer mistral-real-key-abc')
    sent.headers.forEach((v) => expect(v).not.toContain('sl_live_'))
  })

  test('x-spanlens-* headers stripped before reaching upstream', async () => {
    mockUpstream(openAIChatResponse({ model: 'mistral-small-latest' }))
    const app = await buildApp()

    await app.request('/proxy/mistral/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-spanlens-user': 'usr_internal',
        'x-spanlens-session': 'sess_internal',
      },
      body: JSON.stringify({ model: 'mistral-small-latest', messages: [] }),
    })
    await drainPendingTasks()

    proxyState.fetchCalls[0]!.headers.forEach((_v, k) => {
      expect(k.toLowerCase().startsWith('x-spanlens-')).toBe(false)
    })
  })
})

describe('mistral proxy — guards', () => {
  test('NO_PROVIDER_KEY 400 with provider:"mistral" detail', async () => {
    proxyState.decryptedKey = ''
    const app = await buildApp()

    const res = await app.request('/proxy/mistral/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistral-small-latest', messages: [] }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string; details: { provider: string } } }
    expect(body.error.code).toBe('NO_PROVIDER_KEY')
    expect(body.error.details.provider).toBe('mistral')
    expect(proxyState.fetchCalls).toHaveLength(0)
  })

  test('public-scope key returns 403 PUBLIC_KEY_WRITE_FORBIDDEN', async () => {
    proxyState.scope = 'public'
    const app = await buildApp()

    const res = await app.request('/proxy/mistral/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'mistral-small-latest', messages: [] }),
    })

    expect(res.status).toBe(403)
    expect(proxyState.fetchCalls).toHaveLength(0)
  })
})

describe('mistral proxy — logging + cost', () => {
  test('parsed tokens + Mistral cost forwarded to logRequestAsync', async () => {
    mockUpstream(openAIChatResponse({
      model: 'mistral-large-latest',
      promptTokens: 1_000_000,
      completionTokens: 500_000,
    }))
    const app = await buildApp()

    await app.request('/proxy/mistral/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistral-large-latest', messages: [] }),
    })
    await drainPendingTasks()

    expect(proxyState.loggerCalls).toHaveLength(1)
    const row = proxyState.loggerCalls[0]!
    expect(row['provider']).toBe('mistral')
    expect(row['model']).toBe('mistral-large-latest')
    expect(row['promptTokens']).toBe(1_000_000)
    expect(row['completionTokens']).toBe(500_000)
    // mistral-large-latest: $2.00 / 1M prompt + $6.00 / 1M completion
    // 1M * 2.00 + 0.5M * 6.00 = 2 + 3 = 5
    expect(row['costUsd']).toBeCloseTo(5.0, 4)
  })

  test('upstream non-2xx is passed through and recorded with errorMessage', async () => {
    mockUpstream(new Response(
      JSON.stringify({ message: 'Invalid model id' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ))
    const app = await buildApp()

    const res = await app.request('/proxy/mistral/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'unknown-model', messages: [] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(400)
    expect(proxyState.loggerCalls[0]!['statusCode']).toBe(400)
    expect((proxyState.loggerCalls[0]!['errorMessage'] as string)).toContain('Invalid model id')
  })
})
