import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Span body injection from the streaming writers must follow the same
// retention policy as the `requests` row.
//
// When a proxied streaming call carries `x-span-id`, the stream writers copy
// the prompt (spans.input) and the reconstructed completion (spans.output)
// onto that span after logging the request row. That copy used to skip every
// rule the request row obeys: the customer's `x-spanlens-log-body` opt-out
// (meta / none), org body sampling (organizations.body_sample_rate), API-key
// masking, and the 64 KiB inline cap. A customer who picked `meta` still had
// the full prompt and response stored on the span, where GET /traces/:id
// returns it verbatim.
//
// The DB client is mocked the way Supabase actually behaves: a failed write
// resolves to `{ error }` instead of rejecting, and every update payload is
// recorded so the assertions check exactly what would have been stored.
//
// calculateCost is deliberately NOT mocked. The provider-scoped price lookup
// is part of what is under test (streaming cost for OpenAI-compatible
// providers used to be looked up under 'openai').
// ─────────────────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  /** Recorded `spans` update payloads, in call order. */
  spanUpdates: [] as Array<Record<string, unknown>>,
  /** organizations.body_sample_rate served to getOrgBodySampleRate. */
  sampleRate: 1 as number,
  /** Stands in for the `requests` row writer; its argument is the row input. */
  logRequestAsync: vi.fn(async (_data: unknown) => undefined),
}))

vi.mock('../lib/logger.js', () => ({
  logRequestAsync: (d: unknown) => state.logRequestAsync(d),
}))

vi.mock('../lib/db.js', () => {
  const spansUpdateChain = () => {
    const chain = {
      eq: () => chain,
      is: async () => ({ error: null }),
    }
    return chain
  }
  const supabaseAdmin = {
    from: (table: string) => {
      if (table === 'spans') {
        return {
          update: (payload: Record<string, unknown>) => {
            state.spanUpdates.push(payload)
            return spansUpdateChain()
          },
        }
      }
      if (table === 'organizations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { body_sample_rate: state.sampleRate },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table in test: ${table}`)
    },
  }
  return { supabaseAdmin, supabaseClient: {} }
})

type StreamLogger = typeof import('../proxy/stream-logger.js')
type StreamBase = Parameters<StreamLogger['logOpenAIStream']>[1]

let logOpenAIStream: StreamLogger['logOpenAIStream']
let logOpenRouterStream: StreamLogger['logOpenRouterStream']
let logAnthropicStream: StreamLogger['logAnthropicStream']
let setPriceCache: typeof import('../lib/model-prices-cache.js')['_setCacheForTests']

const SPAN_ID = '99999999-8888-4777-8666-555555555555'
const LEAKED_KEY = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUV1234'

function makeBase(overrides: Partial<StreamBase> = {}): StreamBase {
  return {
    organizationId: 'org-1',
    projectId: 'proj-1',
    provider: 'openai',
    model: 'gpt-4o',
    requestBody: { messages: [{ role: 'user', content: `my key is ${LEAKED_KEY}` }] },
    responseBody: null,
    statusCode: 200,
    errorMessage: null,
    traceId: null,
    spanId: SPAN_ID,
    latencyMs: 100,
    ...overrides,
  } as StreamBase
}

function openAILines(text: string, usage = { prompt_tokens: 1000, completion_tokens: 100 }): string[] {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }], model: 'gpt-4o' })}`,
    `data: ${JSON.stringify({ choices: [], usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } })}`,
    'data: [DONE]',
  ]
}

function anthropicLines(text: string): string[] {
  return [
    `data: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-sonnet-4-5', usage: { input_tokens: 20 } } })}`,
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}`,
    `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 5 } })}`,
  ]
}

function inputUpdate(): unknown {
  return state.spanUpdates.find((u) => 'input' in u)?.['input']
}

function outputUpdate(): unknown {
  return state.spanUpdates.find((u) => 'output' in u)?.['output']
}

function loggedRow(): Record<string, unknown> {
  return state.logRequestAsync.mock.calls[0]?.[0] as Record<string, unknown>
}

beforeEach(async () => {
  vi.resetModules()
  state.spanUpdates.length = 0
  state.sampleRate = 1
  state.logRequestAsync.mockClear()
  ;({ logOpenAIStream, logOpenRouterStream, logAnthropicStream } = await import('../proxy/stream-logger.js'))
  ;({ _setCacheForTests: setPriceCache } = await import('../lib/model-prices-cache.js'))
  setPriceCache({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── logBodyMode opt-out ─────────────────────────────────────────────────────

describe('span injection honors x-spanlens-log-body', () => {
  test("OpenAI stream with logBodyMode='meta' writes nothing to the span", async () => {
    await logOpenAIStream(openAILines('secret answer'), makeBase({ logBodyMode: 'meta' }))

    expect(state.logRequestAsync).toHaveBeenCalledOnce()
    expect(state.spanUpdates).toEqual([])
  })

  test("Anthropic stream with logBodyMode='none' writes nothing to the span", async () => {
    await logAnthropicStream(
      anthropicLines('secret answer'),
      makeBase({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        requestBody: { system: 'private system prompt', messages: [{ role: 'user', content: 'hi' }] },
        logBodyMode: 'none',
      }),
    )

    expect(state.logRequestAsync).toHaveBeenCalledOnce()
    expect(state.spanUpdates).toEqual([])
  })

  test("OpenRouter stream with logBodyMode='meta' writes nothing to the span", async () => {
    await logOpenRouterStream(
      openAILines('secret answer'),
      makeBase({ provider: 'openrouter', model: 'openai/gpt-4o', logBodyMode: 'meta' }),
    )

    expect(state.spanUpdates).toEqual([])
  })

  test("full mode still injects input and output (default behavior kept)", async () => {
    await logOpenAIStream(openAILines('hello there'), makeBase({ logBodyMode: 'full' }))

    expect(inputUpdate()).toEqual({
      messages: [{ role: 'user', content: 'my key is sk-proj-***' }],
    })
    expect(outputUpdate()).toBe('hello there')
  })
})

// ── org body sampling ──────────────────────────────────────────────────────

describe('span injection honors org body sampling', () => {
  test('body_sample_rate 0 drops span bodies and the request row bodies alike', async () => {
    state.sampleRate = 0

    await logOpenAIStream(openAILines('sampled out'), makeBase())

    expect(state.spanUpdates).toEqual([])
    expect(loggedRow()['storeBody']).toBe(false)
  })

  test('the request row and the span share one sampling draw', async () => {
    state.sampleRate = 0.5

    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    await logOpenAIStream(openAILines('out'), makeBase())
    expect(state.spanUpdates).toEqual([])
    expect(loggedRow()['storeBody']).toBe(false)

    state.logRequestAsync.mockClear()
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    await logOpenAIStream(openAILines('in'), makeBase())
    expect(outputUpdate()).toBe('in')
    expect(loggedRow()['storeBody']).toBe(true)
  })
})

// ── masking + inline cap ─────────────────────────────────────────────────────

describe('span injection masks keys and caps size', () => {
  test('API keys in the prompt and completion are masked, JSON shape preserved', async () => {
    await logAnthropicStream(
      anthropicLines(`here you go: ${LEAKED_KEY}`),
      makeBase({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        requestBody: {
          system: `use sk-ant-${'a'.repeat(30)}`,
          messages: [{ role: 'user', content: `key ${LEAKED_KEY}` }],
        },
      }),
    )

    expect(inputUpdate()).toEqual({
      system: 'use sk-ant-***',
      messages: [{ role: 'user', content: 'key sk-proj-***' }],
    })
    expect(outputUpdate()).toBe('here you go: sk-proj-***')
    expect(JSON.stringify(state.spanUpdates)).not.toContain(LEAKED_KEY)
  })

  test('bodies above 64 KiB are replaced by the truncation envelope', async () => {
    const hugePrompt = 'x'.repeat(70_000)
    const hugeAnswer = 'y'.repeat(70_000)

    await logOpenAIStream(
      openAILines(hugeAnswer),
      makeBase({ requestBody: { messages: [{ role: 'user', content: hugePrompt }] } }),
    )

    const input = inputUpdate() as Record<string, unknown>
    const output = outputUpdate() as Record<string, unknown>
    expect(input['_truncated']).toBe(true)
    expect(input['_original_size_bytes']).toBeGreaterThan(64 * 1024)
    expect(String(input['_preview']).length).toBeLessThanOrEqual(2 * 1024)
    expect(output['_truncated']).toBe(true)
    expect(output['_original_size_bytes']).toBe(70_000)
  })

  test('a key sitting on the 2 KiB preview boundary is masked before the cut', async () => {
    // Put the key so the preview slice would end in the middle of it. Masking
    // after truncation would leave a partial key in _preview. The space keeps
    // the key pattern from swallowing the filler that follows it.
    const filler = 'z'.repeat(2048 - 15)
    const text = `${filler}${LEAKED_KEY} ${'w'.repeat(70_000)}`

    await logOpenAIStream(openAILines(text), makeBase())

    const output = outputUpdate() as Record<string, unknown>
    expect(output['_truncated']).toBe(true)
    expect(String(output['_preview'])).not.toContain('sk-proj-ABCDEFG')
  })
})

// ── cost lookup is provider-scoped ───────────────────────────────────────────

describe('logOpenAIStream prices with the real provider', () => {
  function costOf(): unknown {
    return loggedRow()['costUsd']
  }

  test('xAI grok row that only exists under xai: is found (was null)', async () => {
    setPriceCache({ 'xai:grok-4.20-0309-reasoning': { prompt: 2, completion: 6 } })

    await logOpenAIStream(
      openAILines('ok'),
      makeBase({ provider: 'xai', model: 'grok-4.20-0309-reasoning', spanId: null }),
    )

    expect(costOf()).toBeCloseTo((1000 * 2 + 100 * 6) / 1_000_000, 12)
  })

  test('Groq qwen uses the groq row, not the cheaper openrouter row', async () => {
    setPriceCache({
      'groq:qwen/qwen3-32b': { prompt: 0.29, completion: 0.59 },
      'openrouter:qwen/qwen3-32b': { prompt: 0.08, completion: 0.24 },
    })

    await logOpenAIStream(
      openAILines('ok'),
      makeBase({ provider: 'groq', model: 'qwen/qwen3-32b', spanId: null }),
    )

    expect(costOf()).toBeCloseTo((1000 * 0.29 + 100 * 0.59) / 1_000_000, 12)
  })

  test('Azure keeps borrowing the OpenAI table', async () => {
    setPriceCache({ 'openai:gpt-4o': { prompt: 3, completion: 12 } })

    await logOpenAIStream(
      openAILines('ok'),
      makeBase({ provider: 'azure', model: 'gpt-4o', spanId: null }),
    )

    expect(costOf()).toBeCloseTo((1000 * 3 + 100 * 12) / 1_000_000, 12)
  })
})
