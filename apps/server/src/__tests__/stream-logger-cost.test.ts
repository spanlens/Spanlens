import { beforeEach, describe, expect, test, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// B-3: a streaming response that is cut before its final usage chunk (the 290s
// deadline or a client disconnect) yields 0 captured tokens. Previously
// calculateCost(0 tokens) returned { totalCost: 0 }, so the row persisted a
// misleading cost_usd = $0 that looked like a real zero-cost call. The fix
// records cost_usd = null ("unknown") when no usage was captured, leaving the
// truncated flag to mark the row incomplete.
//
// These tests pin that behavior: no usage → null cost (and calculateCost is not
// even called); usage present → cost computed as before.
// ─────────────────────────────────────────────────────────────────────────────

const logRequestAsyncMock = vi.fn()
const calculateCostMock = vi.fn()

vi.mock('../lib/logger.js', () => ({
  logRequestAsync: (d: unknown) => logRequestAsyncMock(d),
}))

vi.mock('../lib/cost.js', () => ({
  calculateCost: (...args: unknown[]) => calculateCostMock(...args),
}))

// stream-logger imports supabaseAdmin at module load (for span input/output
// injection). We never set a spanId here, so injection is skipped; this mock
// just avoids creating a real client.
vi.mock('../lib/db.js', () => ({
  supabaseAdmin: { from: () => ({}) },
}))

let logOpenAIStream: typeof import('../proxy/stream-logger.js').logOpenAIStream
let logAnthropicStream: typeof import('../proxy/stream-logger.js').logAnthropicStream

function makeBase(): Parameters<typeof logOpenAIStream>[1] {
  return {
    organizationId: 'o1',
    projectId: 'p1',
    provider: 'openai',
    model: 'gpt-4o',
    requestBody: { messages: [{ role: 'user', content: 'hi' }] },
    responseBody: null,
    statusCode: 200,
    errorMessage: null,
    traceId: null,
    spanId: null,
    latencyMs: 100,
  } as Parameters<typeof logOpenAIStream>[1]
}

function loggedArg(): { costUsd: number | null; truncated?: boolean } {
  return logRequestAsyncMock.mock.calls[0]?.[0] as { costUsd: number | null; truncated?: boolean }
}

beforeEach(async () => {
  vi.resetModules()
  logRequestAsyncMock.mockReset()
  calculateCostMock.mockReset()
  calculateCostMock.mockReturnValue({
    totalCost: 0.05,
    promptCost: 0,
    completionCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
  })
  ;({ logOpenAIStream, logAnthropicStream } = await import('../proxy/stream-logger.js'))
})

describe('logOpenAIStream cost on truncation', () => {
  test('truncated stream, no usage chunk → cost_usd null, calculateCost not called', async () => {
    // Only a content delta arrived; the final usage chunk never did.
    const lines = ['data: {"choices":[{"delta":{"content":"partial"}}],"model":"gpt-4o"}']

    await logOpenAIStream(lines, makeBase(), { truncated: true })

    expect(logRequestAsyncMock).toHaveBeenCalledOnce()
    expect(loggedArg().costUsd).toBeNull()
    expect(loggedArg().truncated).toBe(true)
    // No fabricated $0 — we don't even attempt a cost calc without usage.
    expect(calculateCostMock).not.toHaveBeenCalled()
  })

  test('complete stream with usage chunk → cost computed normally', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"hello"}}],"model":"gpt-4o"}',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15},"model":"gpt-4o"}',
      'data: [DONE]',
    ]

    await logOpenAIStream(lines, makeBase(), {})

    expect(calculateCostMock).toHaveBeenCalledOnce()
    expect(loggedArg().costUsd).toBe(0.05)
  })
})

describe('logAnthropicStream cost on truncation', () => {
  test('no usage captured → cost_usd null', async () => {
    // A bare content delta with no message_start usage and no output deltas.
    const lines = ['data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}']

    await logAnthropicStream(lines, { ...makeBase(), provider: 'anthropic', model: 'claude-3-5-sonnet' }, { truncated: true })

    expect(logRequestAsyncMock).toHaveBeenCalledOnce()
    expect(loggedArg().costUsd).toBeNull()
    expect(calculateCostMock).not.toHaveBeenCalled()
  })
})
