/**
 * Vercel AI SDK tracker token accounting (C7.4).
 *
 * From AI SDK 5.0 on, `onFinish` receives `usage` for the LAST step only and
 * the run's sum in `totalUsage` (ai@5.0.0 stream-text.ts, still true in 6.x).
 * The tracker read `usage`, so a two-step tool run of 120 + 60 tokens was
 * recorded as 60. In 4.x `usage` is already the combined total.
 *
 * `generateText` has no `onFinish` in 4.x / 5.x, so the documented
 * `generateText({ onFinish })` never closed the span; `tracker.end(result)`
 * is the path for awaited calls.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpanlensTracker } from '../integrations/vercel-ai.js'
import { SpanlensClient } from '../client.js'

interface Call {
  method: string
  path: string
  body: Record<string, unknown>
}

function stubFetch() {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({
        method: init.method ?? 'GET',
        path: new URL(url).pathname,
        body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
      })
      return Promise.resolve(new Response('{}', { status: 200 }))
    }),
  )
  return {
    spanEnd: () => calls.find((c) => c.method === 'PATCH' && c.path.startsWith('/ingest/spans/'))?.body,
    traceEnd: () =>
      calls.find((c) => c.method === 'PATCH' && /^\/ingest\/traces\/[^/]+$/.test(c.path))?.body,
  }
}

function makeClient() {
  return new SpanlensClient({ apiKey: 'sl_live_test', baseUrl: 'http://x' })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSpanlensTracker usage totals', () => {
  it('prefers totalUsage over the last step’s usage (AI SDK 5.x / 6.x)', async () => {
    const net = stubFetch()
    const client = makeClient()
    const tracker = createSpanlensTracker({ client, modelName: 'gpt-4o' })

    await tracker.onStepFinish({ usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } })
    await tracker.onStepFinish({ usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 } })
    await tracker.onFinish({
      usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
      totalUsage: { inputTokens: 140, outputTokens: 40, totalTokens: 180 },
      finishReason: 'stop',
      text: 'done',
    })
    await client.flush()

    const body = net.spanEnd()
    expect(body?.['prompt_tokens']).toBe(140)
    expect(body?.['completion_tokens']).toBe(40)
    expect(body?.['total_tokens']).toBe(180)
    expect((body?.['metadata'] as Record<string, unknown>)['steps']).toBe(2)
  })

  it('sums step usage when the finish event has no totalUsage', async () => {
    const net = stubFetch()
    const client = makeClient()
    const tracker = createSpanlensTracker({ client })

    await tracker.onStepFinish({ usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } })
    await tracker.onStepFinish({ usage: { inputTokens: 40, outputTokens: 20 } })
    await tracker.onFinish({ usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 } })
    await client.flush()

    const body = net.spanEnd()
    expect(body?.['prompt_tokens']).toBe(140)
    expect(body?.['completion_tokens']).toBe(40)
    expect(body?.['total_tokens']).toBe(180)
  })

  it('falls back to usage when neither totalUsage nor steps were seen (AI SDK 4.x)', async () => {
    const net = stubFetch()
    const client = makeClient()
    const tracker = createSpanlensTracker({ client })

    await tracker.onFinish({ usage: { promptTokens: 30, completionTokens: 10, totalTokens: 40 } })
    await client.flush()

    expect(net.spanEnd()?.['total_tokens']).toBe(40)
  })
})

describe('tracker.end(result) for awaited generateText / generateObject', () => {
  it('closes the span and its trace from the awaited result', async () => {
    const net = stubFetch()
    const client = makeClient()
    const tracker = createSpanlensTracker({ client, modelName: 'gpt-4o' })

    // Shape of `await generateText(...)` in AI SDK 5.x.
    await tracker.end({
      text: 'Hello!',
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 },
      totalUsage: { inputTokens: 9, outputTokens: 11, totalTokens: 20 },
      response: { modelId: 'gpt-4o-2024-11-20' },
    })
    await client.flush()

    const body = net.spanEnd()
    expect(body?.['status']).toBe('completed')
    expect(body?.['output']).toBe('Hello!')
    expect(body?.['total_tokens']).toBe(20)
    expect((body?.['metadata'] as Record<string, unknown>)['model']).toBe('gpt-4o-2024-11-20')
    expect(net.traceEnd()?.['status']).toBe('completed')
  })

  it('records a structured object as JSON text output', async () => {
    const net = stubFetch()
    const client = makeClient()
    const tracker = createSpanlensTracker({ client })

    await tracker.end({ object: { city: 'Tokyo', days: 3 }, usage: { inputTokens: 1, outputTokens: 1 } })
    await client.flush()

    expect(net.spanEnd()?.['output']).toBe('{"city":"Tokyo","days":3}')
  })
})
