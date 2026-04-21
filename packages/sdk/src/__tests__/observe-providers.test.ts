import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SpanlensClient } from '../client.js'
import { observeOpenAI, observeAnthropic, observeGemini } from '../observe.js'

describe('observeOpenAI / observeAnthropic / observeGemini', () => {
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

  it('observeOpenAI injects tracing headers into callback', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let receivedHeaders: Record<string, string> | null = null
    await observeOpenAI(trace, 'call-gpt4', async (headers) => {
      receivedHeaders = headers
      return {
        model: 'gpt-4o',
        usage: { prompt_tokens: 50, completion_tokens: 100, total_tokens: 150 },
      }
    })

    expect(receivedHeaders).not.toBeNull()
    expect(receivedHeaders!['x-trace-id']).toBe(trace.traceId)
    expect(receivedHeaders!['x-span-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('observeOpenAI auto-parses usage into span.end', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observeOpenAI(trace, 'call', async () => ({
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }))

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit).method === 'PATCH',
    )
    expect(patchCall).toBeDefined()
    const body = JSON.parse((patchCall![1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.total_tokens).toBe(30)
    expect(body.prompt_tokens).toBe(10)
    expect(body.completion_tokens).toBe(20)
    expect(body.status).toBe('completed')
    expect((body.metadata as Record<string, unknown>).model).toBe('gpt-4o-mini')
  })

  it('observeOpenAI creates span with spanType=llm', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observeOpenAI(trace, 'call', async () => ({ usage: { total_tokens: 0 } }))
    await new Promise((r) => setTimeout(r, 10))

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/spans') &&
        (init as RequestInit).method === 'POST',
    )
    expect(postCall).toBeDefined()
    const body = JSON.parse((postCall![1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.span_type).toBe('llm')
    expect(body.name).toBe('call')
  })

  it('observeAnthropic parses input_tokens/output_tokens', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observeAnthropic(trace, 'msg', async () => ({
      model: 'claude-haiku-4-5',
      usage: { input_tokens: 15, output_tokens: 45 },
    }))

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit).method === 'PATCH',
    )
    const body = JSON.parse((patchCall![1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.prompt_tokens).toBe(15)
    expect(body.completion_tokens).toBe(45)
    expect(body.total_tokens).toBe(60)
  })

  it('observeGemini parses usageMetadata', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observeGemini(trace, 'gen', async () => ({
      modelVersion: 'gemini-1.5-flash',
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 15,
        totalTokenCount: 20,
      },
    }))

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit).method === 'PATCH',
    )
    const body = JSON.parse((patchCall![1] as RequestInit).body as string) as Record<string, unknown>
    expect(body.total_tokens).toBe(20)
  })

  it('marks span as error and rethrows when callback fails', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await expect(
      observeOpenAI(trace, 'boom', async () => {
        throw new Error('api failed')
      }),
    ).rejects.toThrow('api failed')

    const errPatch = fetchMock.mock.calls.find(([, init]) => {
      const ri = init as RequestInit | undefined
      if (!ri || ri.method !== 'PATCH') return false
      const body = JSON.parse(ri.body as string) as Record<string, unknown>
      return body.status === 'error' && body.error_message === 'api failed'
    })
    expect(errPatch).toBeDefined()
  })

  it('works when parent is a SpanHandle (nested LLM call)', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })
    const outer = trace.span({ name: 'agent_loop' })

    let receivedHeaders: Record<string, string> | null = null
    await observeOpenAI(outer, 'inner-call', async (headers) => {
      receivedHeaders = headers
      return { usage: { total_tokens: 0 } }
    })

    expect(receivedHeaders).not.toBeNull()
    // The inner span should be a child of `outer`
    await new Promise((r) => setTimeout(r, 10))
    const spanPosts = fetchMock.mock.calls.filter(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/spans') &&
        (init as RequestInit).method === 'POST',
    )
    // Outer span post + inner span post = 2
    expect(spanPosts.length).toBeGreaterThanOrEqual(2)
    const innerPost = spanPosts.find((call) => {
      const body = JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>
      return body.name === 'inner-call'
    })
    expect(innerPost).toBeDefined()
    const innerBody = JSON.parse((innerPost![1] as RequestInit).body as string) as Record<string, unknown>
    expect(innerBody.parent_span_id).toBe(outer.spanId)
  })
})
