/**
 * Tests for LangChain, Vercel AI, and LlamaIndex integrations.
 *
 * Mocks `fetch` at the global level (same pattern as client.test.ts) so we
 * exercise the real transport and span/trace creation logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSpanlensCallbackHandler } from '../integrations/langchain.js'
import { createSpanlensTracker } from '../integrations/vercel-ai.js'
import { registerSpanlensCallbacks } from '../integrations/llamaindex.js'
import { SpanlensClient } from '../client.js'

// ── Shared fetch mock setup ────────────────────────────────────────────────

type FetchCall = { url: string; method: string; body: Record<string, unknown> }

function stubFetch() {
  const calls: FetchCall[] = []

  const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
    const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {}
    calls.push({ url, method: init.method ?? 'GET', body })
    return Promise.resolve(
      new Response(JSON.stringify({ id: (url as string).split('/').at(-1) }), { status: 200 }),
    )
  })

  vi.stubGlobal('fetch', fetchMock)

  return {
    calls,
    posts: () => calls.filter((c) => c.method === 'POST'),
    patches: () => calls.filter((c) => c.method === 'PATCH'),
    spanPatches: () =>
      calls.filter((c) => c.method === 'PATCH' && c.url.includes('/spans/')),
    tracePatches: () =>
      calls.filter(
        (c) => c.method === 'PATCH' && c.url.includes('/traces/') && !c.url.includes('/spans'),
      ),
  }
}

function makeClient() {
  return new SpanlensClient({ apiKey: 'sl_live_test', baseUrl: 'http://test' })
}

/** Wait for fire-and-forget promise chains to settle (same as client.test.ts pattern). */
function tick(ms = 20): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── LangChain ──────────────────────────────────────────────────────────────

describe('createSpanlensCallbackHandler (LangChain)', () => {
  it('creates a span on handleLLMStart and ends it on handleLLMEnd with token usage', async () => {
    const { spanPatches } = stubFetch()
    const client = makeClient()
    const handler = createSpanlensCallbackHandler({ client })

    handler.handleLLMStart({ id: ['ChatOpenAI'], name: 'ChatOpenAI' }, ['Hello'], 'run-1')
    await handler.handleLLMEnd(
      {
        llmOutput: {
          tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model_name: 'gpt-4o',
        },
        generations: [[{ text: 'World' }]],
      },
      'run-1',
    )

    const patches = spanPatches()
    expect(patches.length).toBeGreaterThanOrEqual(1)
    const body = patches[0]?.body ?? {}
    expect(body['prompt_tokens']).toBe(10)
    expect(body['completion_tokens']).toBe(20)
    expect(body['total_tokens']).toBe(30)
    expect(body['status']).toBe('completed')
    expect(body['output']).toBe('World')
  })

  it('ends span with error status on handleLLMError', async () => {
    const { spanPatches } = stubFetch()
    const client = makeClient()
    const handler = createSpanlensCallbackHandler({ client })

    handler.handleChatModelStart({ id: ['ChatAnthropic'] }, [['msg']], 'run-err')
    await handler.handleLLMError(new Error('API timeout'), 'run-err')

    const patches = spanPatches()
    expect(patches.length).toBeGreaterThanOrEqual(1)
    const body = patches[0]?.body ?? {}
    expect(body['status']).toBe('error')
    expect(String(body['error_message'])).toContain('API timeout')
  })

  it('ignores handleLLMEnd for unknown runId without throwing', async () => {
    const { calls } = stubFetch()
    const client = makeClient()
    const handler = createSpanlensCallbackHandler({ client })

    await expect(
      handler.handleLLMEnd({ llmOutput: { tokenUsage: {} } }, 'unknown-run'),
    ).resolves.toBeUndefined()

    await tick()
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
  })

  it('does not end the outer trace when an external trace is provided', async () => {
    const { tracePatches } = stubFetch()
    const client = makeClient()
    const trace = client.startTrace({ name: 'outer' })
    const handler = createSpanlensCallbackHandler({ client, trace })

    handler.handleLLMStart({ id: ['Model'] }, ['p'], 'run-2')
    await handler.handleLLMEnd({}, 'run-2')

    // Only 1 trace POST (the outer trace), 0 trace PATCHes (caller owns lifecycle)
    expect(tracePatches()).toHaveLength(0)
  })

  it('handles concurrent runs independently by runId', async () => {
    const { spanPatches } = stubFetch()
    const client = makeClient()
    const handler = createSpanlensCallbackHandler({ client })

    handler.handleLLMStart({ id: ['ModelA'] }, ['p1'], 'run-a')
    handler.handleLLMStart({ id: ['ModelB'] }, ['p2'], 'run-b')

    await handler.handleLLMEnd(
      { llmOutput: { tokenUsage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } } },
      'run-a',
    )
    await handler.handleLLMEnd(
      { llmOutput: { tokenUsage: { promptTokens: 8, completionTokens: 8, totalTokens: 16 } } },
      'run-b',
    )

    expect(spanPatches()).toHaveLength(2)
  })
})

// ── Vercel AI SDK ──────────────────────────────────────────────────────────

describe('createSpanlensTracker (Vercel AI SDK)', () => {
  it('creates a span immediately and ends it on onFinish with usage and model', async () => {
    const { spanPatches, posts } = stubFetch()
    const client = makeClient()
    const tracker = createSpanlensTracker({ client, modelName: 'gpt-4o' })

    await tracker.onFinish({
      usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
      finishReason: 'stop',
      text: 'Hello!',
      response: { modelId: 'gpt-4o-2024-11-20' },
    })

    // A span POST was made with the correct span name
    const spanPost = posts().find((c) => c.url.includes('/spans'))
    expect(spanPost?.body['name']).toBe('llm.gpt-4o')

    const patches = spanPatches()
    expect(patches.length).toBeGreaterThanOrEqual(1)
    const body = patches[0]?.body ?? {}
    expect(body['prompt_tokens']).toBe(15)
    expect(body['completion_tokens']).toBe(25)
    expect(body['total_tokens']).toBe(40)
    expect(body['output']).toBe('Hello!')
    expect(body['status']).toBe('completed')
  })

  it('records error status when finishReason is error', async () => {
    const { spanPatches } = stubFetch()
    const client = makeClient()
    const tracker = createSpanlensTracker({ client })

    await tracker.onFinish({ finishReason: 'error', usage: {} })

    const body = spanPatches()[0]?.body ?? {}
    expect(body['status']).toBe('error')
  })

  it('onStepFinish resolves without throwing', async () => {
    stubFetch()
    const client = makeClient()
    const tracker = createSpanlensTracker({ client, modelName: 'claude-3-5-sonnet' })

    await expect(tracker.onStepFinish({ stepType: 'initial' })).resolves.toBeUndefined()
    await expect(tracker.onStepFinish({ stepType: 'tool-result' })).resolves.toBeUndefined()
  })

  it('does not call trace.end when an external trace is provided', async () => {
    const { tracePatches } = stubFetch()
    const client = makeClient()
    const trace = client.startTrace({ name: 'pipeline' })
    const tracker = createSpanlensTracker({ client, trace, modelName: 'gpt-4o-mini' })

    await tracker.onFinish({ usage: { promptTokens: 1, completionTokens: 1 } })

    expect(tracePatches()).toHaveLength(0)
  })

  it('computes totalTokens from promptTokens + completionTokens when missing', async () => {
    const { spanPatches } = stubFetch()
    const client = makeClient()
    const tracker = createSpanlensTracker({ client })

    await tracker.onFinish({
      usage: { promptTokens: 5, completionTokens: 7 },  // no totalTokens
    })

    const body = spanPatches()[0]?.body ?? {}
    expect(body['total_tokens']).toBe(12)
  })
})

// ── LlamaIndex ─────────────────────────────────────────────────────────────

describe('registerSpanlensCallbacks (LlamaIndex)', () => {
  function createMockSettings() {
    const listeners = new Map<string, Array<(payload: unknown) => void>>()
    return {
      callbackManager: {
        on(event: string, handler: (payload: unknown) => void) {
          const list = listeners.get(event) ?? []
          list.push(handler)
          listeners.set(event, list)
        },
        off(event: string, handler: (payload: unknown) => void) {
          const list = listeners.get(event) ?? []
          listeners.set(
            event,
            list.filter((h) => h !== handler),
          )
        },
        emit(event: string, payload: unknown) {
          listeners.get(event)?.forEach((h) => h(payload))
        },
        listenerCount(event: string) {
          return listeners.get(event)?.length ?? 0
        },
      },
    }
  }

  it('registers llm-start/llm-end hooks, records span with token usage', async () => {
    const { spanPatches } = stubFetch()
    const client = makeClient()
    const settings = createMockSettings()

    registerSpanlensCallbacks(settings, { client })

    settings.callbackManager.emit('llm-start', {
      id: 'call-1',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    settings.callbackManager.emit('llm-end', {
      id: 'call-1',
      response: {
        raw: {
          usage: { input_tokens: 5, output_tokens: 10 },
          model: 'gpt-4o',
        },
        message: { role: 'assistant', content: 'Hello!' },
      },
    })

    // Allow fire-and-forget promise chain to settle
    await tick()

    const patches = spanPatches()
    expect(patches.length).toBeGreaterThanOrEqual(1)
    const body = patches[0]?.body ?? {}
    expect(body['prompt_tokens']).toBe(5)
    expect(body['completion_tokens']).toBe(10)
    expect(body['total_tokens']).toBe(15)
    expect(body['status']).toBe('completed')
  })

  it('returns unregister function that removes both hooks', () => {
    stubFetch()
    const client = makeClient()
    const settings = createMockSettings()

    const unregister = registerSpanlensCallbacks(settings, { client })
    expect(settings.callbackManager.listenerCount('llm-start')).toBe(1)
    expect(settings.callbackManager.listenerCount('llm-end')).toBe(1)

    unregister()
    expect(settings.callbackManager.listenerCount('llm-start')).toBe(0)
    expect(settings.callbackManager.listenerCount('llm-end')).toBe(0)
  })

  it('ignores llm-end for unknown call id without patching', async () => {
    const { calls } = stubFetch()
    const client = makeClient()
    const settings = createMockSettings()

    registerSpanlensCallbacks(settings, { client })
    settings.callbackManager.emit('llm-end', {
      id: 'ghost-id',
      response: { raw: { usage: { input_tokens: 1 } } },
    })

    await tick()
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0)
  })

  it('does not end the outer trace when an external trace is provided', async () => {
    const { tracePatches } = stubFetch()
    const client = makeClient()
    const settings = createMockSettings()

    const trace = client.startTrace({ name: 'rag' })
    registerSpanlensCallbacks(settings, { client, trace })

    settings.callbackManager.emit('llm-start', { id: 'x', messages: [] })
    settings.callbackManager.emit('llm-end', {
      id: 'x',
      response: { raw: { usage: { input_tokens: 3, output_tokens: 7 } } },
    })

    await tick()
    expect(tracePatches()).toHaveLength(0)
  })
})
