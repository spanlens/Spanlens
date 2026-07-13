import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  buildJudgeMessages,
  type JudgeConfig,
} from '../lib/eval-runners/judge-prompt.js'
import { callJudge } from '../lib/eval-runner.js'

/**
 * P4-1: judge prompt caching.
 *
 * Two layers under test:
 *   1. buildJudgeMessages — the static/variable split that makes caching
 *      possible. The system part must be byte-identical across rows of a run
 *      (so it forms a stable cache prefix); the per-row response must live only
 *      in the user part.
 *   2. judgeComplete (via callJudge) — the static system is sent with
 *      cache_control for Anthropic, and the cached-token portion of usage is
 *      billed at the reduced cacheRead rate so reported cost reflects savings.
 *
 * callJudge is called with organizationId=null so the judge_cache DB layer is
 * bypassed and only the LLM call path is exercised (fetch is stubbed).
 */

// ── buildJudgeMessages: the cache-boundary split ──────────────────────────────

describe('buildJudgeMessages — static/variable split', () => {
  const cfg = { scale_min: 0, scale_max: 1 }

  test('criterion + reply schema go in the system part, not the user part', () => {
    const { system, user } = buildJudgeMessages('Is it helpful?', 'Paris is the capital.', cfg)
    expect(system).toContain('Is it helpful?')
    expect(system).toContain('"score": <number between 0 and 1>')
    expect(user).not.toContain('Is it helpful?')
    expect(user).not.toContain('"score"')
  })

  test('the response under evaluation goes in the user part, not the system part', () => {
    const { system, user } = buildJudgeMessages('crit', 'UNIQUE_RESPONSE_TOKEN', cfg)
    expect(user).toContain('UNIQUE_RESPONSE_TOKEN')
    expect(system).not.toContain('UNIQUE_RESPONSE_TOKEN')
  })

  test('system is byte-identical across different responses (stable cache prefix)', () => {
    const a = buildJudgeMessages('crit', 'response one', cfg)
    const b = buildJudgeMessages('crit', 'a totally different response two', cfg)
    expect(a.system).toBe(b.system)
    expect(a.user).not.toBe(b.user)
  })

  test('rubric + anchors stay in the cached system part', () => {
    const { system, user } = buildJudgeMessages('crit', 'resp', {
      ...cfg,
      rubric: 'be strict about citations',
      anchors: [{ response: 'great', score: 1, reasoning: 'cited well' }],
    })
    expect(system).toContain('be strict about citations')
    expect(system).toContain('Calibration examples')
    expect(user).not.toContain('be strict')
  })

  test('golden reference (per-row) goes in the user part', () => {
    const { system, user } = buildJudgeMessages('crit', 'resp', {
      ...cfg,
      expected_output: 'GOLDEN_ANSWER_REF',
    })
    expect(user).toContain('GOLDEN_ANSWER_REF')
    expect(system).not.toContain('GOLDEN_ANSWER_REF')
  })
})

// ── judgeComplete cache wiring (via callJudge + stubbed fetch) ─────────────────

function numericConfig(over: Partial<JudgeConfig> = {}): JudgeConfig {
  return {
    criterion: 'Is the answer factually correct?',
    judge_provider: 'anthropic',
    judge_model: 'claude-opus-4-7',
    scale_min: 0,
    scale_max: 1,
    score_config: null,
    ...over,
  }
}

/** Capture the single fetch call and return a canned provider response. */
function stubFetch(responseBody: unknown): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
    } as unknown as Response
  }))
  return { calls }
}

describe('callJudge — Anthropic prompt caching', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  test('sends the static system as a cache_control ephemeral block', async () => {
    const { calls } = stubFetch({
      content: [{ type: 'text', text: '{"score": 0.9, "reasoning": "correct"}' }],
      usage: { input_tokens: 50, output_tokens: 10 },
      model: 'claude-opus-4-7',
    })

    await callJudge(numericConfig(), 'Paris is the capital of France.', 'sk-ant-test', null)

    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0]!.init.body as string)
    // The user message carries only the response, not the criterion.
    expect(body.messages[0].content).toContain('Paris is the capital of France.')
    expect(body.messages[0].content).not.toContain('factually correct')
    // The system is a cache-control block holding the static instructions.
    expect(Array.isArray(body.system)).toBe(true)
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(body.system[0].text).toContain('factually correct')
  })

  test('bills the cached-read portion at the reduced cacheRead rate', async () => {
    // opus-4-7 fallback prices: prompt 5, completion 25, cacheRead 0.5 (per 1M).
    // usage: 100 non-cached input + 2000 cache-read + 20 output.
    //   nonCached  = 100  → 100/1e6 * 5     = 0.0005
    //   cacheRead  = 2000 → 2000/1e6 * 0.5  = 0.001
    //   completion = 20   → 20/1e6 * 25     = 0.0005
    //   total = 0.0020
    // Without cache accounting the 2000 tokens would bill at 5 (=> ~0.011).
    const { calls } = stubFetch({
      content: [{ type: 'text', text: '{"score": 1, "reasoning": "ok"}' }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 0,
      },
      model: 'claude-opus-4-7',
    })

    const outcome = await callJudge(numericConfig(), 'resp', 'sk-ant-test', null)

    expect(calls).toHaveLength(1)
    expect(outcome).not.toBeNull()
    expect(outcome!.cost).toBeCloseTo(0.002, 6)
    // tokens counts the full input (incl. cache) + output: 2100 + 20.
    expect(outcome!.tokens).toBe(2120)
  })

  test('cache-creation tokens are billed at the cacheWrite premium', async () => {
    // First row of a run writes the cache: cache_creation billed at 6.25/1M.
    //   nonCached  = 50   → 50/1e6 * 5      = 0.00025
    //   cacheWrite = 1500 → 1500/1e6 * 6.25 = 0.009375
    //   completion = 10   → 10/1e6 * 25     = 0.00025
    //   total = 0.009875
    const { calls } = stubFetch({
      content: [{ type: 'text', text: '{"score": 0.5, "reasoning": ""}' }],
      usage: {
        input_tokens: 50,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1500,
      },
      model: 'claude-opus-4-7',
    })

    const outcome = await callJudge(numericConfig(), 'resp', 'sk-ant-test', null)
    expect(calls).toHaveLength(1)
    expect(outcome!.cost).toBeCloseTo(0.009875, 6)
  })
})

describe('callJudge — OpenAI automatic prefix caching', () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  afterEach(() => { vi.unstubAllGlobals() })

  test('sends the static instructions as a separate system role message', async () => {
    const { calls } = stubFetch({
      choices: [{ message: { content: '{"score": 0.8, "reasoning": "good"}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 10 },
      model: 'gpt-4o',
    })

    await callJudge(
      numericConfig({ judge_provider: 'openai', judge_model: 'gpt-4o' }),
      'A sample response.',
      'sk-openai-test',
      null,
    )

    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('factually correct')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toContain('A sample response.')
  })

  test('bills cached_tokens at the reduced cacheRead rate', async () => {
    // gpt-4o fallback: prompt 2.5, completion 10, cacheRead 1.25 (per 1M).
    //   nonCached  = 100  → 100/1e6 * 2.5  = 0.00025
    //   cacheRead  = 2000 → 2000/1e6 * 1.25 = 0.0025
    //   completion = 20   → 20/1e6 * 10    = 0.0002
    //   total = 0.00295
    const { calls } = stubFetch({
      choices: [{ message: { content: '{"score": 1, "reasoning": ""}' } }],
      usage: {
        prompt_tokens: 2100,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 2000 },
      },
      model: 'gpt-4o',
    })

    const outcome = await callJudge(
      numericConfig({ judge_provider: 'openai', judge_model: 'gpt-4o' }),
      'resp',
      'sk-openai-test',
      null,
    )
    expect(calls).toHaveLength(1)
    expect(outcome!.cost).toBeCloseTo(0.00295, 6)
  })
})
