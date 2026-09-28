import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { drainPendingTasks, mockUpstream, openAIChatResponse, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

/**
 * Where proxy timing starts (C9.3).
 *
 * `proxy_overhead_ms` is documented, and published as an SLO, as the time
 * Spanlens adds before forwarding: auth, rate limits, quota, key decryption,
 * body parsing. It used to start at the first line of the route handler,
 * i.e. AFTER authApiKey / proxyRateLimit / enforceQuota / customerRateLimit
 * had already run, so a cold auth cache or a slow Upstash call never showed
 * up in it. The 290s stream deadline counted from the same late point, so
 * middleware time silently ate into the 10s grace window under Vercel's 300s
 * ceiling.
 *
 * The auth mock below sleeps to stand in for a cold key lookup.
 */

const timing = vi.hoisted(() => {
  // Read by stream-deadline.ts at module load, which happens on the first
  // dynamic import in buildApp(), after this runs.
  process.env['STREAM_DEADLINE_MS'] = '400'
  return { authDelayMs: 60 }
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

vi.mock('../middleware/authApiKey.js', async () => {
  const actual = await vi.importActual<typeof import('../middleware/authApiKey.js')>(
    '../middleware/authApiKey.js',
  )
  return {
    ...actual,
    authApiKey: (async (c: Context, next: Next) => {
      await sleep(timing.authDelayMs)
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
  const actual = await vi.importActual<typeof import('../proxy/utils.js')>('../proxy/utils.js')
  return {
    ...actual,
    getDecryptedProviderKey: vi.fn(async () => ({
      plaintext: proxyState.decryptedKey,
      id: proxyState.providerKeyId,
      metadata: {},
    })),
    isBlockingEnabled: vi.fn(async () => false),
  }
})

vi.mock('../lib/logger.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/logger.js')>('../lib/logger.js')
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

/** Mirrors app.ts: the timing stamp runs ahead of every proxy middleware. */
async function buildApp() {
  const { Hono } = await import('hono')
  const { requestStart } = await import('../middleware/requestStart.js')
  const { openaiProxy } = await import('../proxy/openai.js')
  const app = new Hono()
  app.use('/proxy/*', requestStart)
  app.route('/proxy/openai', openaiProxy)
  installOnError(app)
  return app
}

function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const tick = (): void => {
      if (check()) return resolve()
      if (Date.now() - startedAt > timeoutMs) return reject(new Error('waitFor timed out'))
      setTimeout(tick, 5)
    }
    tick()
  })
}

beforeEach(() => {
  resetProxyMocks()
  timing.authDelayMs = 60
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('proxy timing starts when the request reaches the proxy (C9.3)', () => {
  test('proxy_overhead_ms includes the time spent in auth / rate-limit / quota middleware', async () => {
    mockUpstream(openAIChatResponse())
    const app = await buildApp()

    const res = await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [] }),
    })
    await drainPendingTasks()

    expect(res.status).toBe(200)
    const row = proxyState.loggerCalls[0]!
    // Timer slack: setTimeout may fire a millisecond or two early.
    expect(row['proxyOverheadMs'] as number).toBeGreaterThanOrEqual(timing.authDelayMs - 5)
  })

  test('the stream deadline counts from request arrival, not from the route handler', async () => {
    // Deadline 400ms (env above). With 300ms spent in middleware, a deadline
    // anchored at the handler would close the stream ~700ms after arrival.
    timing.authDelayMs = 300
    const encoder = new TextEncoder()
    const hanging = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
        // ...and never closes, like a generation that outlives the budget.
      },
    })
    // Not mockUpstream(): it hands out resp.clone(), and cancelling one branch
    // of a tee never settles while the other branch stays open, so the
    // deadline's reader.cancel() would hang on the test double itself.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(hanging, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    const app = await buildApp()

    const startedAt = Date.now()
    const res = await app.request('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [], stream: true }),
    })
    const reader = res.body!.getReader()
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    await waitFor(() => proxyState.loggerCalls.length > 0)
    const elapsed = Date.now() - startedAt

    const row = proxyState.loggerCalls[0]!
    expect(row['truncated']).toBe(true)
    expect(elapsed).toBeLessThan(600)
  })
})

describe('app.ts wiring', () => {
  test('the request-start stamp is the first middleware registered, ahead of cors / auth', async () => {
    const path = fileURLToPath(new URL('../app.ts', import.meta.url))
    const source = await readFile(path, 'utf8')
    const firstUse = /^app\.use\((.+)\)$/m.exec(source)
    expect(firstUse?.[1]).toBe("'/proxy/*', requestStart")
  })
})
