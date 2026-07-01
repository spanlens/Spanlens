import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { drainPendingTasks, mockUpstream, openAIChatResponse, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * Integration tests for the four OpenAI-compatible provider proxies added
 * together: Groq, DeepSeek, xAI, and Cohere. Each reuses the OpenAI parser +
 * stream logger, so these tests pin the per-provider contract:
 *   1. Upstream URL is built from the provider's base + the path with the
 *      /proxy/<provider> prefix stripped.
 *   2. Authorization carries the decrypted provider key, never the customer
 *      Spanlens key.
 *   3. The log row carries the right provider tag and cost from the seed.
 *   4. NO_PROVIDER_KEY (400) and public-scope (403) guards behave like the
 *      other proxies.
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

vi.mock('../middleware/customerRateLimit.js', () => ({
  customerRateLimit: (async (_c: Context, next: Next) => { await next() }) as MiddlewareHandler,
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
  const { groqProxy } = await import('../proxy/groq.js')
  const { deepseekProxy } = await import('../proxy/deepseek.js')
  const { xaiProxy } = await import('../proxy/xai.js')
  const { cohereProxy } = await import('../proxy/cohere.js')
  const app = new Hono()
  app.route('/proxy/groq', groqProxy)
  app.route('/proxy/deepseek', deepseekProxy)
  app.route('/proxy/xai', xaiProxy)
  app.route('/proxy/cohere', cohereProxy)
  installOnError(app)
  return app
}

interface ProviderCase {
  slug: string
  expectedUrl: string
  model: string
  // prompt 1M + completion 0.5M against the seed price → expectedCost
  expectedCost: number
}

const CASES: ProviderCase[] = [
  // groq llama-3.3-70b-versatile: $0.59/1M in + $0.79/1M out → 1*0.59 + 0.5*0.79
  { slug: 'groq', expectedUrl: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', expectedCost: 0.985 },
  // deepseek-chat: $0.14/1M in + $0.28/1M out → 1*0.14 + 0.5*0.28
  { slug: 'deepseek', expectedUrl: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat', expectedCost: 0.28 },
  // grok-4.3: $1.25/1M in + $2.50/1M out → 1*1.25 + 0.5*2.50
  { slug: 'xai', expectedUrl: 'https://api.x.ai/v1/chat/completions', model: 'grok-4.3', expectedCost: 2.5 },
  // command-a-03-2025: $2.50/1M in + $10.00/1M out → 1*2.50 + 0.5*10.00
  { slug: 'cohere', expectedUrl: 'https://api.cohere.ai/compatibility/v1/chat/completions', model: 'command-a-03-2025', expectedCost: 7.5 },
]

beforeEach(() => {
  resetProxyMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

for (const c of CASES) {
  describe(`${c.slug} proxy`, () => {
    test(`upstream URL strips /proxy/${c.slug} and targets the provider host`, async () => {
      mockUpstream(openAIChatResponse({ model: c.model }))
      const app = await buildApp()

      await app.request(`/proxy/${c.slug}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: c.model, messages: [] }),
      })
      await drainPendingTasks()

      expect(proxyState.fetchCalls[0]!.url).toBe(c.expectedUrl)
    })

    test('Authorization carries the decrypted provider key, not sl_live_*', async () => {
      proxyState.decryptedKey = `${c.slug}-real-key-abc`
      mockUpstream(openAIChatResponse({ model: c.model }))
      const app = await buildApp()

      await app.request(`/proxy/${c.slug}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer sl_live_customer_must_not_leak',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: c.model, messages: [] }),
      })
      await drainPendingTasks()

      const sent = proxyState.fetchCalls[0]!
      expect(sent.headers.get('authorization')).toBe(`Bearer ${c.slug}-real-key-abc`)
      sent.headers.forEach((v) => expect(v).not.toContain('sl_live_'))
    })

    test('log row carries the provider tag + seed cost', async () => {
      mockUpstream(openAIChatResponse({
        model: c.model,
        promptTokens: 1_000_000,
        completionTokens: 500_000,
      }))
      const app = await buildApp()

      await app.request(`/proxy/${c.slug}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: c.model, messages: [] }),
      })
      await drainPendingTasks()

      expect(proxyState.loggerCalls).toHaveLength(1)
      const row = proxyState.loggerCalls[0]!
      expect(row['provider']).toBe(c.slug)
      expect(row['model']).toBe(c.model)
      expect(row['costUsd']).toBeCloseTo(c.expectedCost, 4)
    })

    test('NO_PROVIDER_KEY 400 with matching provider detail', async () => {
      proxyState.decryptedKey = ''
      const app = await buildApp()

      const res = await app.request(`/proxy/${c.slug}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: c.model, messages: [] }),
      })

      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string; details: { provider: string } } }
      expect(body.error.code).toBe('NO_PROVIDER_KEY')
      expect(body.error.details.provider).toBe(c.slug)
      expect(proxyState.fetchCalls).toHaveLength(0)
    })

    test('public-scope key returns 403 PUBLIC_KEY_WRITE_FORBIDDEN', async () => {
      proxyState.scope = 'public'
      const app = await buildApp()

      const res = await app.request(`/proxy/${c.slug}/v1/chat/completions`, {
        method: 'POST',
        body: JSON.stringify({ model: c.model, messages: [] }),
      })

      expect(res.status).toBe(403)
      expect(proxyState.fetchCalls).toHaveLength(0)
    })
  })
}
