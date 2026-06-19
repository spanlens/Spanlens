/**
 * Judge transport: the low-level "send a prompt to the judge model" call plus
 * the absolute / pairwise / trajectory wrappers that interpret the reply.
 *
 * Extracted from eval-runner.ts (4B) so both the eval runner and the prompt
 * A/B experiment runner share exactly one judge implementation. Adding a new
 * judge provider now touches one file instead of two.
 *
 * We hit each vendor API directly (not our own /proxy) on purpose: this runs
 * server-side and bypasses the customer-facing proxy.
 */

import { fetchWithRetry } from './shared.js'
import { calculateCost } from '../cost.js'
import { buildOpenAIBody } from '../playground-runner.js'
import {
  buildJudgePrompt,
  parseJudgeReply,
  buildPairwiseJudgePrompt,
  parsePairwiseReply,
  type JudgeConfig,
  type TypedScoreConfig,
  type PairwiseWinner,
} from './judge-prompt.js'
import { buildTrajectoryJudgePrompt } from './trajectory.js'
import {
  hashEvaluatorConfig,
  hashSampleInputs,
  lookupJudgeCache,
  storeJudgeCache,
} from './judge-cache.js'

export interface JudgeOutcome {
  // For NUMERIC configs (and the legacy NULL path) this stays the
  // normalized 0..1 score. For CATEGORICAL / BOOLEAN / TEXT it is null
  // and the typed columns below carry the actual answer.
  score: number | null
  reasoning: string
  cost: number
  tokens: number
  // 4B.1c — typed value columns. Exactly one of these is non-null per
  // outcome (mirrors the eval_results table layout).
  value_number: number | null
  value_string: string | null
  value_boolean: boolean | null
  // P3-15 — the judge's RAW numeric answer before clamp/normalisation.
  // Lets the dashboard render "4 out of 5" instead of only the derived 0.8.
  // null for non-numeric typed configs and for legacy rows.
  value_raw_number: number | null
  // P3-18 — true when this outcome came from judge_cache. `cost` and `tokens`
  // are 0 in that case; the original call's cost is in `cached_savings_usd`
  // so the runner can report cumulative savings. Always false for embedding
  // and trajectory outcomes.
  cached: boolean
  cached_savings_usd: number
}

type JudgeProvider = JudgeConfig['judge_provider']

/** Gemini responseSchema for the single-judge path, keyed off the score config.
 * Must match the JSON shape the prompt asks for or Gemini errors. */
function geminiJudgeSchema(sc: TypedScoreConfig | null | undefined): Record<string, unknown> {
  if (!sc || sc.data_type === 'NUMERIC') {
    return { type: 'object', properties: { score: { type: 'number' }, reasoning: { type: 'string' } }, required: ['score', 'reasoning'] }
  }
  if (sc.data_type === 'BOOLEAN') {
    return { type: 'object', properties: { value: { type: 'boolean' }, reasoning: { type: 'string' } }, required: ['value', 'reasoning'] }
  }
  // CATEGORICAL + TEXT both emit a string `value`.
  return { type: 'object', properties: { value: { type: 'string' }, reasoning: { type: 'string' } }, required: ['value', 'reasoning'] }
}

/** Gemini responseSchema for the pairwise path. */
const GEMINI_PAIRWISE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { winner: { type: 'string' }, reasoning: { type: 'string' } },
  required: ['winner', 'reasoning'],
}

/**
 * Low-level judge call: send `prompt` to the judge model and return the raw
 * reply text + cost + tokens WITHOUT interpreting it. Shared by the absolute
 * (callJudge) and pairwise (callPairwiseJudge) paths so the five provider
 * integrations live in exactly one place. Returns null on any transport
 * failure (non-ok / network), which the callers treat as a dropped sample.
 */
async function judgeComplete(
  provider: JudgeProvider,
  model: string,
  apiKey: string,
  resourceUrl: string | null,
  prompt: string,
  geminiResponseSchema: Record<string, unknown>,
): Promise<{ text: string; cost: number; tokens: number } | null> {
  // OpenAI, Azure, Mistral, OpenRouter are all OpenAI-compatible chat
  // completions; only the URL, auth header, and cost-table provider differ.
  if (provider === 'openai' || provider === 'azure' || provider === 'mistral' || provider === 'openrouter') {
    let url: string
    let headers: Record<string, string>
    if (provider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions'
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    } else if (provider === 'mistral') {
      url = 'https://api.mistral.ai/v1/chat/completions'
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    } else if (provider === 'openrouter') {
      url = 'https://openrouter.ai/api/v1/chat/completions'
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    } else {
      // Azure: per-key resource origin + api-key header. Without it we can't
      // build the URL — fail rather than hit a wrong endpoint.
      if (!resourceUrl) return null
      url = `${resourceUrl}/openai/v1/chat/completions`
      headers = { 'Content-Type': 'application/json', 'api-key': apiKey }
    }
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildOpenAIBody(
        model,
        [{ role: 'user', content: prompt }],
        { temperature: 0, maxTokens: 200, responseFormat: { type: 'json_object' } },
      )),
    })
    if (!res || !res.ok) return null
    const json = await res.json() as {
      choices: Array<{ message: { content: string } }>
      usage: { prompt_tokens: number; completion_tokens: number; cost?: number }
      model: string
    }
    const text = json.choices?.[0]?.message?.content ?? ''
    const tokens = (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0)
    // Azure bills at OpenAI prices; OpenRouter publishes the authoritative
    // billed cost on usage.cost (same pattern as proxy/openrouter.ts).
    let cost = 0
    if (provider === 'openrouter' && typeof json.usage?.cost === 'number') {
      cost = json.usage.cost
    } else {
      const costProvider = provider === 'azure' ? 'openai' : provider
      cost = calculateCost(costProvider, json.model ?? model, {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
      })?.totalCost ?? 0
    }
    return { text, cost, tokens }
  }

  if (provider === 'anthropic') {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 200, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res || !res.ok) return null
    const json = await res.json() as {
      content: Array<{ type: string; text: string }>
      usage: { input_tokens: number; output_tokens: number }
      model: string
    }
    const text = json.content?.find((b) => b.type === 'text')?.text ?? ''
    const tokens = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0)
    const cost = calculateCost('anthropic', json.model ?? model, {
      promptTokens: json.usage?.input_tokens ?? 0,
      completionTokens: json.usage?.output_tokens ?? 0,
    })?.totalCost ?? 0
    return { text, cost, tokens }
  }

  // Gemini — JSON output enforced via responseMimeType + responseSchema so the
  // reply is always parseable. The schema MUST match the prompt's JSON shape.
  if (provider === 'gemini') {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 200,
            responseMimeType: 'application/json',
            responseSchema: geminiResponseSchema,
          },
        }),
      },
    )
    if (!res || !res.ok) return null
    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      modelVersion?: string
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const tokens = (json.usageMetadata?.promptTokenCount ?? 0) + (json.usageMetadata?.candidatesTokenCount ?? 0)
    const cost = calculateCost('gemini', json.modelVersion ?? model, {
      promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    })?.totalCost ?? 0
    return { text, cost, tokens }
  }

  // Unknown provider — explicit escape hatch so a future addition to the
  // JudgeProvider union can't silently fall through to Gemini.
  return null
}

/** Calls the judge LLM once. Returns null on failure (caller skips the sample).
 *
 * P3-18: when `organizationId` is provided the result is memoised in
 * judge_cache keyed by (org, config_hash, response+expected_hash). A second
 * call with the same inputs returns the cached outcome at $0 and sets
 * `cached: true`. Pass `organizationId: null` to bypass the cache (used by
 * unit tests that don't want a DB round-trip).
 */
export async function callJudge(
  config: JudgeConfig,
  responseText: string,
  apiKey: string,
  /** Azure resource origin (provider_keys.provider_metadata.resource_url).
   * Required when config.judge_provider === 'azure'; ignored otherwise. */
  resourceUrl: string | null,
  /** Golden answer (P1-6). When present (dataset items with expected_output)
   * it is injected into the prompt as a reference for the judge. */
  expectedOutput: string | null = null,
  /** P3-18: enables judge_cache lookup / store. Null disables caching. */
  organizationId: string | null = null,
): Promise<JudgeOutcome | null> {
  // P3-18: cache lookup. Compute both hashes up front; on hit, skip the LLM
  // call entirely. On miss/failure, fall through to the real call. The cache
  // helpers swallow errors so a flaky judge_cache never breaks scoring.
  let configHash: string | null = null
  let inputsHash: string | null = null
  if (organizationId) {
    try {
      configHash = await hashEvaluatorConfig(config)
      inputsHash = await hashSampleInputs(responseText, expectedOutput)
      const hit = await lookupJudgeCache({ organizationId, configHash, responseHash: inputsHash })
      if (hit) {
        return {
          score: hit.score,
          value_number: hit.value_number,
          value_string: hit.value_string,
          value_boolean: hit.value_boolean,
          value_raw_number: hit.value_raw_number,
          reasoning: hit.reasoning,
          cost: 0,
          tokens: 0,
          cached: true,
          cached_savings_usd: hit.original_cost_usd,
        }
      }
    } catch {
      // Hash failures (Web Crypto unavailable in some test envs) bypass the
      // cache silently — never block a real eval over caching plumbing.
      configHash = null
      inputsHash = null
    }
  }

  const prompt = buildJudgePrompt(config.criterion, responseText, {
    scale_min: config.scale_min,
    scale_max: config.scale_max,
    score_config: config.score_config ?? null,
    expected_output: expectedOutput,
    // P1-7: rubric + few-shot anchors carried on the evaluator config.
    rubric: config.rubric ?? null,
    anchors: config.anchors ?? null,
  })

  const res = await judgeComplete(
    config.judge_provider,
    config.judge_model,
    apiKey,
    resourceUrl,
    prompt,
    geminiJudgeSchema(config.score_config),
  )
  if (!res) return null

  const parsed = parseJudgeReply(res.text, {
    scale_min: config.scale_min,
    scale_max: config.scale_max,
    score_config: config.score_config ?? null,
  })
  if (!parsed) return null

  // Turn the parsed reply into the stored JudgeOutcome. NUMERIC / legacy
  // normalise into 0..1 so the `score` column stays consistent with pre-4B.1c
  // rows; typed paths carry the value_* columns straight through. P3-15
  // additionally preserves the clamped-but-not-normalised raw answer so the
  // dashboard can render the original scale ("4 out of 5", not only 0.8).
  const sc = config.score_config
  let outcome: JudgeOutcome
  if (!sc || sc.data_type === 'NUMERIC') {
    const min = sc?.min_value ?? config.scale_min
    const max = sc?.max_value ?? config.scale_max
    const range = max - min || 1
    const raw = parsed.value_number ?? parsed.score ?? 0
    const normalised = (raw - min) / range
    outcome = {
      score: normalised,
      value_number: normalised,
      value_string: null,
      value_boolean: null,
      value_raw_number: raw,
      reasoning: parsed.reasoning,
      cost: res.cost,
      tokens: res.tokens,
      cached: false,
      cached_savings_usd: 0,
    }
  } else {
    outcome = {
      score: null,
      value_number: parsed.value_number,
      value_string: parsed.value_string,
      value_boolean: parsed.value_boolean,
      value_raw_number: null,
      reasoning: parsed.reasoning,
      cost: res.cost,
      tokens: res.tokens,
      cached: false,
      cached_savings_usd: 0,
    }
  }

  // P3-18: store on cache miss (writes are best-effort, errors swallowed).
  if (organizationId && configHash && inputsHash) {
    void storeJudgeCache({
      organizationId,
      configHash,
      responseHash: inputsHash,
      outcome: {
        score: outcome.score,
        value_number: outcome.value_number,
        value_string: outcome.value_string,
        value_boolean: outcome.value_boolean,
        value_raw_number: outcome.value_raw_number,
        reasoning: outcome.reasoning,
        original_cost_usd: outcome.cost,
        original_tokens: outcome.tokens,
      },
    })
  }
  return outcome
}

/** Outcome of one pairwise comparison (P1-7 3/3). `winner` is in PROMPT terms
 * (A vs B as shown to the judge); the caller un-swaps it for counterbalancing. */
export interface PairwiseOutcome {
  winner: PairwiseWinner
  reasoning: string
  cost: number
  tokens: number
}

/** Calls the judge once to compare two responses. Returns null on failure. */
export async function callPairwiseJudge(
  config: JudgeConfig,
  responseA: string,
  responseB: string,
  apiKey: string,
  resourceUrl: string | null,
  expectedOutput: string | null = null,
): Promise<PairwiseOutcome | null> {
  const prompt = buildPairwiseJudgePrompt(config.criterion, responseA, responseB, {
    rubric: config.rubric ?? null,
    expected_output: expectedOutput,
  })
  const res = await judgeComplete(
    config.judge_provider,
    config.judge_model,
    apiKey,
    resourceUrl,
    prompt,
    GEMINI_PAIRWISE_SCHEMA,
  )
  if (!res) return null
  const parsed = parsePairwiseReply(res.text)
  if (!parsed) return null
  return { winner: parsed.winner, reasoning: parsed.reasoning, cost: res.cost, tokens: res.tokens }
}

/** Outcome of judging one agent trajectory (P2-11). `score` is normalised 0..1. */
export interface TrajectoryOutcome {
  score: number
  reasoning: string
  cost: number
  tokens: number
}

/** Calls the judge once on a serialized agent trajectory. Returns null on failure. */
export async function callTrajectoryJudge(
  config: JudgeConfig,
  trajectoryText: string,
  apiKey: string,
  resourceUrl: string | null,
): Promise<TrajectoryOutcome | null> {
  const prompt = buildTrajectoryJudgePrompt(config.criterion, trajectoryText, {
    scale_min: config.scale_min,
    scale_max: config.scale_max,
    rubric: config.rubric ?? null,
  })
  const res = await judgeComplete(
    config.judge_provider,
    config.judge_model,
    apiKey,
    resourceUrl,
    prompt,
    geminiJudgeSchema(null),
  )
  if (!res) return null
  const parsed = parseJudgeReply(res.text, { scale_min: config.scale_min, scale_max: config.scale_max })
  if (!parsed) return null
  // Normalise to 0..1 against the configured scale, same as the legacy path.
  const range = config.scale_max - config.scale_min || 1
  const raw = parsed.value_number ?? parsed.score ?? 0
  const normalised = (raw - config.scale_min) / range
  return { score: normalised, reasoning: parsed.reasoning, cost: res.cost, tokens: res.tokens }
}
