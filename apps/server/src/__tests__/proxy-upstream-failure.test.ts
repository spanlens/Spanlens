import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { drainPendingTasks, proxyState, resetProxyMocks } from './helpers/proxy-mocks.js'
import { installOnError } from './helpers/install-on-error.js'

// Read by upstream-fetch.ts at module load (first dynamic import in
// buildApp), so a body that stalls fails the test in milliseconds instead of
// after the 290s default.
const BODY_DEADLINE_MS = vi.hoisted(() => {
  process.env['UPSTREAM_BODY_DEADLINE_MS'] = '150'
  return 150
})

/**
 * Transport failures between the proxy and a provider, across all ten
 * provider routers.
 *
 * The provider returning an HTTP error was always logged (the status passes
 * through with the error body). What was not:
 *   - C9.1: the provider's connection dying mid-stream. Headers had gone out
 *     as 200, and the row looked like a clean completion.
 *   - C8.2: the fetch itself failing (502 UPSTREAM_FAILED) or timing out
 *     (504 UPSTREAM_TIMEOUT). The throw happened before the row was built,
 *     so the call left no row at all: invisible to /requests, error rates
 *     and alerts.
 *   - C9.2: a non-streaming body that stops arriving after the headers. The
 *     header timer was already cleared, so nothing bounded the wait.
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
      metadata: { resource_url: 'https://example-resource.openai.azure.com' },
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

async function buildApp() {
  const { Hono } = await import('hono')
  const app = new Hono()
  app.route('/proxy/openai', (await import('../proxy/openai.js')).openaiProxy)
  app.route('/proxy/anthropic', (await import('../proxy/anthropic.js')).anthropicProxy)
  app.route('/proxy/gemini', (await import('../proxy/gemini.js')).geminiProxy)
  app.route('/proxy/azure', (await import('../proxy/azure.js')).azureProxy)
  app.route('/proxy/mistral', (await import('../proxy/mistral.js')).mistralProxy)
  app.route('/proxy/openrouter', (await import('../proxy/openrouter.js')).openrouterProxy)
  app.route('/proxy/groq', (await import('../proxy/groq.js')).groqProxy)
  app.route('/proxy/deepseek', (await import('../proxy/deepseek.js')).deepseekProxy)
  app.route('/proxy/xai', (await import('../proxy/xai.js')).xaiProxy)
  app.route('/proxy/cohere', (await import('../proxy/cohere.js')).cohereProxy)
  installOnError(app)
  return app
}

interface ProviderCase {
  slug: string
  /** Non-streaming request path. */
  path: string
  /** Streaming request path (Gemini selects streaming by URL). */
  streamPath: string
  body: Record<string, unknown>
  /** The model the failure row should carry: the one the caller asked for. */
  model: string
  /** First chunk the provider streams before its connection dies. */
  firstChunk: string
}

const OPENAI_CHUNK = 'data: {"id":"c1","model":"m","choices":[{"index":0,"delta":{"content":"par"}}]}\n\n'

const CASES: ProviderCase[] = [
  { slug: 'openai', path: '/proxy/openai/v1/chat/completions', streamPath: '/proxy/openai/v1/chat/completions', body: { model: 'gpt-4o-mini', messages: [] }, model: 'gpt-4o-mini', firstChunk: OPENAI_CHUNK },
  {
    slug: 'anthropic',
    path: '/proxy/anthropic/v1/messages',
    streamPath: '/proxy/anthropic/v1/messages',
    body: { model: 'claude-sonnet-4-6', max_tokens: 16, messages: [] },
    model: 'claude-sonnet-4-6',
    firstChunk:
      'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":12,"output_tokens":1}}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"par"}}\n\n',
  },
  {
    slug: 'gemini',
    path: '/proxy/gemini/v1beta/models/gemini-1.5-pro:generateContent',
    streamPath: '/proxy/gemini/v1beta/models/gemini-1.5-pro:streamGenerateContent?alt=sse',
    body: { contents: [] },
    model: 'gemini-1.5-pro',
    firstChunk: 'data: {"candidates":[{"content":{"parts":[{"text":"par"}]}}]}\n\n',
  },
  { slug: 'azure', path: '/proxy/azure/chat/completions', streamPath: '/proxy/azure/chat/completions', body: { model: 'gpt-4o-mini', messages: [] }, model: 'gpt-4o-mini', firstChunk: OPENAI_CHUNK },
  { slug: 'mistral', path: '/proxy/mistral/v1/chat/completions', streamPath: '/proxy/mistral/v1/chat/completions', body: { model: 'mistral-small-latest', messages: [] }, model: 'mistral-small-latest', firstChunk: OPENAI_CHUNK },
  { slug: 'openrouter', path: '/proxy/openrouter/v1/chat/completions', streamPath: '/proxy/openrouter/v1/chat/completions', body: { model: 'openai/gpt-4o-mini', messages: [] }, model: 'openai/gpt-4o-mini', firstChunk: OPENAI_CHUNK },
  { slug: 'groq', path: '/proxy/groq/v1/chat/completions', streamPath: '/proxy/groq/v1/chat/completions', body: { model: 'llama-3.3-70b-versatile', messages: [] }, model: 'llama-3.3-70b-versatile', firstChunk: OPENAI_CHUNK },
  { slug: 'deepseek', path: '/proxy/deepseek/v1/chat/completions', streamPath: '/proxy/deepseek/v1/chat/completions', body: { model: 'deepseek-flash', messages: [] }, model: 'deepseek-flash', firstChunk: OPENAI_CHUNK },
  { slug: 'xai', path: '/proxy/xai/v1/chat/completions', streamPath: '/proxy/xai/v1/chat/completions', body: { model: 'grok-4.3', messages: [] }, model: 'grok-4.3', firstChunk: OPENAI_CHUNK },
  { slug: 'cohere', path: '/proxy/cohere/v1/chat/completions', streamPath: '/proxy/cohere/v1/chat/completions', body: { model: 'command-a-03-2025', messages: [] }, model: 'command-a-03-2025', firstChunk: OPENAI_CHUNK },
]

function streamBody(pc: ProviderCase): string {
  return JSON.stringify(pc.slug === 'gemini' ? pc.body : { ...pc.body, stream: true })
}

/** A socket reset the way undici reports it. */
function socketReset(): TypeError {
  return new TypeError('terminated', {
    cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
  })
}

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
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
})

afterEach(() => {
  vi.restoreAllMocks()
})

for (const pc of CASES) {
  describe(`${pc.slug} proxy — upstream transport failures`, () => {
    test('a stream the provider drops mid-flight is logged as incomplete, with the reason (C9.1)', async () => {
      const encoder = new TextEncoder()
      // A fresh Response per call, not a clone: a tee branch's cancel would
      // not settle while the other branch stays open.
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(pc.firstChunk))
            setTimeout(() => controller.error(socketReset()), 10)
          },
        })
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      })
      const app = await buildApp()

      const res = await app.request(pc.streamPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: streamBody(pc),
      })
      expect(res.status).toBe(200)
      const reader = res.body!.getReader()
      for (;;) {
        const { done } = await reader.read()
        if (done) break
      }
      await waitFor(() => proxyState.loggerCalls.length > 0)

      const row = proxyState.loggerCalls[0]!
      expect(row['provider']).toBe(pc.slug)
      expect(row['truncated']).toBe(true)
      expect(row['errorMessage']).toBe('Upstream stream interrupted before completion (UND_ERR_SOCKET)')
    })

    test('a network failure before any response is a 502 with a failed-request row (C8.2)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' }),
        }),
      )
      const app = await buildApp()

      const res = await sendNonStreaming(app, pc)
      await drainPendingTasks()

      expect(res.status).toBe(502)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UPSTREAM_FAILED')
      expectFailedRow(pc, 502, 'Upstream request failed before a response (ECONNREFUSED)')
    })

    test('no response headers within the timeout is a 504 with a failed-request row (C8.2)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new DOMException('This operation was aborted', 'AbortError'),
      )
      const app = await buildApp()

      const res = await sendNonStreaming(app, pc)
      await drainPendingTasks()

      expect(res.status).toBe(504)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UPSTREAM_TIMEOUT')
      expectFailedRow(pc, 504, /^Upstream did not return response headers within \d+ms$/)
    })

    test('a non-streaming body that stalls after the headers is cut at the deadline: 504 + row (C9.2)', async () => {
      const encoder = new TextEncoder()
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('{"partial":'))
            // ...and nothing more: a half-open connection.
          },
        })
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
      })
      const app = await buildApp()

      const startedAt = Date.now()
      const res = await sendNonStreaming(app, pc)
      await drainPendingTasks()

      expect(res.status).toBe(504)
      expect(Date.now() - startedAt).toBeLessThan(BODY_DEADLINE_MS + 1000)
      expectFailedRow(
        pc,
        504,
        `Upstream response body did not finish within ${BODY_DEADLINE_MS}ms of the request`,
      )
    })

    test('a connection dropped while reading a non-streaming body is a 502 with a row (C8.2)', async () => {
      const encoder = new TextEncoder()
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('{"partial":'))
            setTimeout(() => controller.error(socketReset()), 5)
          },
        })
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
      })
      const app = await buildApp()

      const res = await sendNonStreaming(app, pc)
      await drainPendingTasks()

      expect(res.status).toBe(502)
      expectFailedRow(pc, 502, 'Upstream connection dropped while reading the response body (UND_ERR_SOCKET)')
    })
  })
}

type TestApp = Awaited<ReturnType<typeof buildApp>>

async function sendNonStreaming(app: TestApp, pc: ProviderCase): Promise<Response> {
  return app.request(pc.path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pc.body),
  })
}

/** The one row a transport failure must leave behind. */
function expectFailedRow(pc: ProviderCase, statusCode: number, message: string | RegExp): void {
  expect(proxyState.loggerCalls).toHaveLength(1)
  const row = proxyState.loggerCalls[0]!
  expect(row['provider']).toBe(pc.slug)
  expect(row['organizationId']).toBe(proxyState.organizationId)
  expect(row['projectId']).toBe(proxyState.projectId)
  expect(row['providerKeyId']).toBe(proxyState.providerKeyId)
  expect(row['model']).toBe(pc.model)
  expect(row['statusCode']).toBe(statusCode)
  // Nothing came back to bill: cost is unknown, not $0.
  expect(row['costUsd']).toBeNull()
  expect(row['promptTokens']).toBe(0)
  expect(row['completionTokens']).toBe(0)
  expect(row['responseBody']).toBeNull()
  expect(typeof row['latencyMs']).toBe('number')
  expect(typeof row['proxyOverheadMs']).toBe('number')
  if (typeof message === 'string') expect(row['errorMessage']).toBe(message)
  else expect(row['errorMessage']).toMatch(message)
}
