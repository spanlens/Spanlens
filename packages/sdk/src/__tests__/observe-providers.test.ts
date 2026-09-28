import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SpanlensClient } from '../client.js'
import { observeOpenAI, observeAnthropic, observeGemini, observeOllama } from '../observe.js'

describe('observeOpenAI / observeAnthropic / observeGemini', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // A fresh Response per call: a shared one has its body consumed after the
    // first read, which turns every later call into a retried "network error".
    fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * observe helpers return before the span's end PATCH is delivered, so every
   * body assertion flushes first, exactly as a short-lived process would.
   */
  async function sentBodies(
    client: SpanlensClient,
    method: 'POST' | 'PATCH',
    pathPart: string,
  ): Promise<Array<Record<string, unknown>>> {
    await client.flush()
    return fetchMock.mock.calls
      .filter(
        ([url, init]) =>
          (init as RequestInit).method === method && String(url).includes(pathPart),
      )
      .map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>)
  }

  async function spanPatch(client: SpanlensClient): Promise<Record<string, unknown>> {
    const [body] = await sentBodies(client, 'PATCH', '/ingest/spans/')
    expect(body).toBeDefined()
    return body!
  }

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

  it('observeOpenAI forwards promptVersion option as x-spanlens-prompt-version header', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let receivedHeaders: Record<string, string> | null = null
    await observeOpenAI(
      trace,
      { name: 'call-v3', promptVersion: 'chatbot-system@3' },
      async (headers) => {
        receivedHeaders = headers
        return {
          model: 'gpt-4o-mini',
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }
      },
    )

    expect(receivedHeaders!['x-spanlens-prompt-version']).toBe('chatbot-system@3')
    // traceparent-style headers should still be present
    expect(receivedHeaders!['x-trace-id']).toBe(trace.traceId)
  })

  it('observeAnthropic forwards promptVersion option', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let receivedHeaders: Record<string, string> | null = null
    await observeAnthropic(
      trace,
      { name: 'call', promptVersion: 'greeter@latest' },
      async (headers) => {
        receivedHeaders = headers
        return {
          model: 'claude-3-5-sonnet-20241022',
          usage: { input_tokens: 5, output_tokens: 7 },
        }
      },
    )

    expect(receivedHeaders!['x-spanlens-prompt-version']).toBe('greeter@latest')
  })

  it('observeGemini forwards promptVersion option', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let receivedHeaders: Record<string, string> | null = null
    await observeGemini(
      trace,
      { name: 'call', promptVersion: 'uuid-like-id-12345' },
      async (headers) => {
        receivedHeaders = headers
        return {
          response: {
            usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 },
          },
        }
      },
    )

    expect(receivedHeaders!['x-spanlens-prompt-version']).toBe('uuid-like-id-12345')
  })

  it('omits prompt version header when option is not provided', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let receivedHeaders: Record<string, string> | null = null
    await observeOpenAI(trace, 'call', async (headers) => {
      receivedHeaders = headers
      return {
        model: 'gpt-4o',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    })

    expect(receivedHeaders!['x-spanlens-prompt-version']).toBeUndefined()
  })

  it('forwards logBody option as x-spanlens-log-body header', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let receivedHeaders: Record<string, string> | null = null
    await observeOpenAI(
      trace,
      { name: 'call', logBody: 'meta' },
      async (headers) => {
        receivedHeaders = headers
        return {
          model: 'gpt-4o',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }
      },
    )

    expect(receivedHeaders!['x-spanlens-log-body']).toBe('meta')
  })

  it('omits logBody header when option is not provided (server defaults to full)', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let receivedHeaders: Record<string, string> | null = null
    await observeOpenAI(trace, 'call', async (headers) => {
      receivedHeaders = headers
      return {
        model: 'gpt-4o',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    })

    expect(receivedHeaders!['x-spanlens-log-body']).toBeUndefined()
  })

  it('forwards cache: true option as x-spanlens-cache header', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let receivedHeaders: Record<string, string> | null = null
    await observeOpenAI(
      trace,
      { name: 'call', cache: true },
      async (headers) => {
        receivedHeaders = headers
        return {
          model: 'gpt-4o',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }
      },
    )

    expect(receivedHeaders!['x-spanlens-cache']).toBe('true')
  })

  it('forwards an integer cache TTL and clamps it to the 86400 cap', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let seconds: Record<string, string> | null = null
    await observeAnthropic(
      trace,
      { name: 'call', cache: 600 },
      async (headers) => {
        seconds = headers
        return { model: 'claude-3-5-sonnet-20241022', usage: { input_tokens: 1, output_tokens: 1 } }
      },
    )
    expect(seconds!['x-spanlens-cache']).toBe('600')

    let capped: Record<string, string> | null = null
    await observeOpenAI(
      trace,
      { name: 'call', cache: 999999 },
      async (headers) => {
        capped = headers
        return {
          model: 'gpt-4o',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }
      },
    )
    expect(capped!['x-spanlens-cache']).toBe('86400')
  })

  it('omits cache header for invalid or absent values', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let absent: Record<string, string> | null = null
    await observeOpenAI(trace, 'call', async (headers) => {
      absent = headers
      return {
        model: 'gpt-4o',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }
    })
    expect(absent!['x-spanlens-cache']).toBeUndefined()

    let invalid: Record<string, string> | null = null
    await observeOpenAI(
      trace,
      { name: 'call', cache: 0 },
      async (headers) => {
        invalid = headers
        return {
          model: 'gpt-4o',
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }
      },
    )
    expect(invalid!['x-spanlens-cache']).toBeUndefined()
  })

  it('observeOpenAI auto-parses usage into span.end', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observeOpenAI(trace, 'call', async () => ({
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }))

    const body = await spanPatch(client)
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

    const [body] = await sentBodies(client, 'POST', '/spans')
    expect(body).toBeDefined()
    expect(body!.span_type).toBe('llm')
    expect(body.name).toBe('call')
  })

  it('observeAnthropic parses input_tokens/output_tokens', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observeAnthropic(trace, 'msg', async () => ({
      model: 'claude-haiku-4-5',
      usage: { input_tokens: 15, output_tokens: 45 },
    }))

    const body = await spanPatch(client)
    expect(body.prompt_tokens).toBe(15)
    expect(body.completion_tokens).toBe(45)
    expect(body.total_tokens).toBe(60)
  })

  it('observeGemini parses usageMetadata from real GenerateContentResult shape', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    // Real Gemini SDK: generateContent() returns { response: GenerateContentResponse }
    await observeGemini(trace, 'gen', async () => ({
      response: {
        modelVersion: 'gemini-2.0-flash',
        candidates: [{ content: { parts: [{ text: 'hello' }], role: 'model' } }],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 15,
          totalTokenCount: 20,
        },
      },
    }))

    const body = await spanPatch(client)
    expect(body.total_tokens).toBe(20)
    expect(body.prompt_tokens).toBe(5)
    expect(body.completion_tokens).toBe(15)
    expect((body.metadata as Record<string, unknown>)?.model).toBe('gemini-2.0-flash')
  })

  // ── Body capture follows logBody (C6.2) ────────────────────────────────────

  const CHAT_RESPONSE = {
    id: 'chatcmpl-abc',
    model: 'gpt-4o-mini',
    choices: [{ message: { role: 'assistant', content: 'PRIVATE ANSWER' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }

  it('observeOpenAI (default logBody = full) captures the full response as span output', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observeOpenAI(trace, 'call', async () => CHAT_RESPONSE)

    const body = await spanPatch(client)
    expect(body.output).toEqual(CHAT_RESPONSE)
  })

  for (const logBody of ['meta', 'none'] as const) {
    it(`observeOpenAI with logBody '${logBody}' sends no span input or output`, async () => {
      const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
      const trace = client.startTrace({ name: 't' })

      await observeOpenAI(
        trace,
        { name: 'pii-call', logBody, input: { prompt: 'PRIVATE PROMPT' } },
        async () => CHAT_RESPONSE,
      )

      const [post] = await sentBodies(client, 'POST', '/spans')
      const patch = await spanPatch(client)
      expect(post).not.toHaveProperty('input')
      expect(patch).not.toHaveProperty('output')
      expect(JSON.stringify([post, patch])).not.toContain('PRIVATE')
      // Metadata the dashboard needs still flows.
      expect(patch.total_tokens).toBe(15)
      expect((patch.metadata as Record<string, unknown>).model).toBe('gpt-4o-mini')
    })
  }

  it('observeOllama keeps prompt and response on the machine by default', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    let headers: Record<string, string> | null = null
    await observeOllama(
      trace,
      { name: 'local', input: { prompt: 'PRIVATE PROMPT' } },
      async (h) => {
        headers = h
        return { ...CHAT_RESPONSE, model: 'llama3.2' }
      },
    )

    const [post] = await sentBodies(client, 'POST', '/spans')
    const patch = await spanPatch(client)
    expect(post).not.toHaveProperty('input')
    expect(patch).not.toHaveProperty('output')
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('PRIVATE')
    expect(patch.total_tokens).toBe(15)
    // The header contract is unchanged: only an explicit logBody emits it.
    expect(headers!['x-spanlens-log-body']).toBeUndefined()
  })

  it("observeOllama with logBody 'full' opts back into sending the response", async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observeOllama(trace, { name: 'local', logBody: 'full' }, async () => CHAT_RESPONSE)

    const patch = await spanPatch(client)
    expect(patch.output).toEqual(CHAT_RESPONSE)
  })

  it('observeOpenAI omits output for stream-like responses', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    const streamLike = { usage: { total_tokens: 5 }, [Symbol.asyncIterator]: () => ({}) }

    await observeOpenAI(trace, 'stream-call', async () => streamLike as unknown as typeof streamLike)

    const body = await spanPatch(client)
    expect(body.output).toBeUndefined()
  })

  it('marks span as error and rethrows when callback fails', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await expect(
      observeOpenAI(trace, 'boom', async () => {
        throw new Error('api failed')
      }),
    ).rejects.toThrow('api failed')

    const body = await spanPatch(client)
    expect(body.status).toBe('error')
    expect(body.error_message).toBe('api failed')
  })

  // ── Provider tag (Ollama + override) ───────────────────────────────────────

  it('observeOpenAI stamps metadata.provider="openai" by default', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    await observeOpenAI(trace, 'call', async () => ({
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    }))

    const body = await spanPatch(client)
    expect((body.metadata as Record<string, unknown>).provider).toBe('openai')
    // Model still flows through alongside the new provider tag.
    expect((body.metadata as Record<string, unknown>).model).toBe('gpt-4o-mini')
  })

  it('observeOllama parses OpenAI-compatible response and tags provider="ollama"', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    // Ollama's /v1 endpoint returns an OpenAI-shaped payload.
    await observeOllama(trace, 'chat', async () => ({
      model: 'llama3.2',
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    }))

    const body = await spanPatch(client)
    expect(body.prompt_tokens).toBe(12)
    expect(body.completion_tokens).toBe(34)
    expect(body.total_tokens).toBe(46)
    expect((body.metadata as Record<string, unknown>).provider).toBe('ollama')
    expect((body.metadata as Record<string, unknown>).model).toBe('llama3.2')
  })

  it('observeOpenAI provider override wins over default tag', async () => {
    const client = new SpanlensClient({ apiKey: 'k', baseUrl: 'http://x' })
    const trace = client.startTrace({ name: 't' })

    // User points OpenAI SDK at vLLM (OpenAI-compatible) and wants the
    // dashboard to label it as 'vllm' not 'openai'.
    await observeOpenAI(
      trace,
      { name: 'vllm-call', provider: 'vllm' },
      async () => ({
        model: 'meta-llama/Llama-3-8B',
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
    )

    const body = await spanPatch(client)
    expect((body.metadata as Record<string, unknown>).provider).toBe('vllm')
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
    await client.flush()
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
