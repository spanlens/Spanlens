import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SpanlensClient } from '../client.js'
import { observe } from '../observe.js'

describe('observe()', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function getPatchBody(): Record<string, unknown> | undefined {
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit).method === 'PATCH')
    if (!call) return undefined
    return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>
  }

  function getAllPatchBodies(): Record<string, unknown>[] {
    return fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit).method === 'PATCH')
      .map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>)
  }

  it('auto-captures non-stream return value as output', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observe(trace, { name: 'call' }, async () => ({ text: 'hello' }))

    const body = getPatchBody()
    expect(body?.output).toEqual({ text: 'hello' })
  })

  it('does not capture output for stream-like return values', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    const streamLike = { [Symbol.asyncIterator]: () => ({}) }
    await observe(trace, { name: 'call' }, async () => streamLike as unknown as typeof streamLike)

    const body = getPatchBody()
    expect(body?.output).toBeUndefined()
  })

  it('sends supplementary output PATCH when user called span.end() manually without output (streaming pattern)', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    const accumulated = await observe(trace, { name: 'stream-call' }, async (span) => {
      // Simulate streaming: user ends span manually with tokens but no output
      await span.end({ status: 'completed', promptTokens: 10, completionTokens: 20, totalTokens: 30 })
      return 'full response text'
    })

    expect(accumulated).toBe('full response text')

    const patches = getAllPatchBodies()
    // First PATCH: user's manual span.end() with tokens
    expect(patches[0]?.prompt_tokens).toBe(10)
    expect(patches[0]?.output).toBeUndefined()
    // Second PATCH: observe()'s supplementary output-only patch
    expect(patches[1]?.output).toBe('full response text')
  })

  it('does NOT send supplementary PATCH when user already captured output in manual span.end()', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observe(trace, { name: 'call' }, async (span) => {
      await span.end({ status: 'completed', output: 'manual output' })
      return 'return value'
    })

    const patches = getAllPatchBodies()
    // Only one PATCH — observe() sees outputCaptured=true and skips
    expect(patches).toHaveLength(1)
    expect(patches[0]?.output).toBe('manual output')
  })

  it('marks span as error and rethrows', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await expect(
      observe(trace, { name: 'boom' }, async () => {
        throw new Error('fail')
      }),
    ).rejects.toThrow('fail')

    const body = getPatchBody()
    expect(body?.status).toBe('error')
    expect(body?.error_message).toBe('fail')
  })
})
