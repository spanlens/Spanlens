import { afterEach, describe, expect, test, vi } from 'vitest'
import { callJudge, generateForItem } from '../lib/eval-runner.js'
import type { JudgeConfig } from '../lib/eval-runner.js'

/**
 * P0-1 regression: before this fix, the judge/generation paths had no
 * `azure` branch, so an azure provider key fell through to the Gemini
 * endpoint (generativelanguage.googleapis.com) and failed 100% of the
 * time. These tests pin that azure now routes to the per-key Azure
 * resource origin with the `api-key` header (mirrors proxy/azure.ts),
 * never to Gemini.
 */

const RESOURCE = 'https://my-resource.openai.azure.com'
const KEY = 'azure-secret-key'

const baseConfig: JudgeConfig = {
  criterion: 'Is the response helpful?',
  judge_provider: 'azure',
  judge_model: 'gpt-4o-mini',
  scale_min: 1,
  scale_max: 5,
  score_config: null,
}

function mockFetchOnce(body: unknown, ok = true): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callJudge — azure', () => {
  test('routes to the Azure resource v1 endpoint with the api-key header (not Gemini)', async () => {
    const fetchMock = mockFetchOnce({
      choices: [{ message: { content: '{"score": 4, "reasoning": "good"}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      model: 'gpt-4o-mini',
    })

    const outcome = await callJudge(baseConfig, 'some response', KEY, RESOURCE)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe(`${RESOURCE}/openai/v1/chat/completions`)
    expect(url).not.toContain('generativelanguage.googleapis.com')
    expect(init.headers['api-key']).toBe(KEY)
    // Azure uses api-key, never Authorization: Bearer.
    expect(init.headers['Authorization']).toBeUndefined()

    // NUMERIC scale 1..5 → (4-1)/(5-1) = 0.75 normalized.
    expect(outcome?.score).toBeCloseTo(0.75)
    expect(outcome?.reasoning).toBe('good')
  })

  test('returns null without calling fetch when resource_url is missing', async () => {
    const fetchMock = mockFetchOnce({})
    const outcome = await callJudge(baseConfig, 'some response', KEY, null)
    expect(outcome).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('returns null on a non-ok upstream response', async () => {
    mockFetchOnce({ error: 'boom' }, false)
    const outcome = await callJudge(baseConfig, 'some response', KEY, RESOURCE)
    expect(outcome).toBeNull()
  })
})

describe('generateForItem — azure', () => {
  test('routes to the Azure resource v1 endpoint and returns the assistant text', async () => {
    const fetchMock = mockFetchOnce({
      choices: [{ message: { content: 'generated answer' } }],
    })

    const out = await generateForItem(
      'system prompt',
      { messages: [{ role: 'user', content: 'hello' }] },
      'azure',
      'gpt-4o-mini',
      KEY,
      RESOURCE,
    )

    expect(out).toBe('generated answer')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe(`${RESOURCE}/openai/v1/chat/completions`)
    expect(url).not.toContain('generativelanguage.googleapis.com')
    expect(init.headers['api-key']).toBe(KEY)
  })

  test('returns null without calling fetch when resource_url is missing', async () => {
    const fetchMock = mockFetchOnce({})
    const out = await generateForItem(
      'system prompt',
      { messages: [{ role: 'user', content: 'hello' }] },
      'azure',
      'gpt-4o-mini',
      KEY,
      null,
    )
    expect(out).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
