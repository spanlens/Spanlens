/**
 * Evaluation runner.
 *
 * Two execution paths share an entry point (runEvalRun) and a sample
 * fetch, but diverge on how the score is produced:
 *
 *   evaluator.type === 'llm_judge'  (default)
 *     1. Fetch evaluator + prompt_version
 *     2. Sample N requests from production OR generate from a dataset
 *     3. Call the judge LLM (using the user's provider key) on each
 *     4. Parse judge reply (typed or NUMERIC) into a JudgeOutcome
 *
 *   evaluator.type === 'regex' | 'json_schema'  (R-7 Phase 1)
 *     1. Fetch evaluator (config only — no provider key needed)
 *     2. Sample N production responses for the prompt_version
 *     3. For each response, run runRegex / runJsonSchema synchronously
 *     4. score = 1 (pass) | 0 (fail), value_boolean mirrors the pass bit
 *
 * Concurrency: the LLM-as-judge path processes samples in a small
 * concurrency window (default 5) to avoid burning rate limits while
 * keeping latency reasonable. The deterministic path is sync-per-row
 * so concurrency is not needed.
 */

import type { Context } from 'hono'
import { supabaseAdmin } from './db.js'
import { fireAndForget } from './wait-until.js'
import { requestsScope, selectRequests } from './requests-query.js'
import { aes256Decrypt } from './crypto.js'
import { validateOutboundUrlSync } from './safe-url.js'
import { calculateCost } from './cost.js'
import { buildOpenAIBody } from './playground-runner.js'
import { startInternalTrace } from './internal-tracing.js'
// Extracted sub-modules. Re-exported below so existing import sites
// (`from '../lib/eval-runner.js'`) keep working unchanged.
import { extractResponseText, fetchWithRetry } from './eval-runners/shared.js'
import { sampleStdDev } from './eval-runners/stats.js'
import { serializeTrajectory, buildTrajectoryJudgePrompt, type TrajectorySpan } from './eval-runners/trajectory.js'
import {
  buildJudgePrompt,
  parseJudgeReply,
  buildPairwiseJudgePrompt,
  parsePairwiseReply,
  type JudgeConfig,
  type TypedScoreConfig,
  type PairwiseWinner,
} from './eval-runners/judge-prompt.js'
import {
  scoreEmbedding,
  EMBEDDING_PROVIDERS,
  type EmbeddingConfig,
} from './eval-runners/embedding.js'
import {
  runRegex,
  runJsonSchema,
  runExactMatch,
  runContains,
  runSimpleEvalRun,
  type RegexConfig,
  type JsonSchemaConfig,
  type ExactMatchConfig,
  type ContainsConfig,
  type DeterministicEvaluatorType,
  type SimpleEvalResult,
} from './eval-runners/deterministic.js'

export { buildJudgePrompt, parseJudgeReply, buildPairwiseJudgePrompt, parsePairwiseReply, runRegex, runJsonSchema, runExactMatch, runContains }
export type {
  JudgeConfig,
  TypedScoreConfig,
  PairwiseWinner,
  RegexConfig,
  JsonSchemaConfig,
  ExactMatchConfig,
  ContainsConfig,
  SimpleEvalResult,
}

// P1-3: concurrency + retry are env-configurable (defaults preserve prior
// behaviour). Generation gets its own pool so a large dataset can't fire all
// items at once (the old uncapped Promise.all).
// P1-3: concurrency is env-configurable (defaults preserve prior behaviour).
// Generation gets its own pool so a large dataset can't fire all items at once.
// fetchWithRetry / EVAL_MAX_RETRIES live in eval-runners/shared.ts (shared with
// the embedding path).
const JUDGE_CONCURRENCY = Number(process.env['EVAL_JUDGE_CONCURRENCY']) || 5
const GENERATION_CONCURRENCY = Number(process.env['EVAL_GENERATION_CONCURRENCY']) || 5

interface JudgeOutcome {
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
}

// extractResponseText moved to ./eval-runners/shared.ts (imported above).

/**
 * Generate a response for a dataset item by running the supplied prompt
 * content + the item's input through the chosen provider. Mirrors the
 * runPrompt() helper in experiment-runner.ts (intentionally inlined here
 * to avoid the runner-to-runner import cycle).
 *
 * Returns the assistant text on success, null on any failure (network,
 * 4xx/5xx, empty output). Callers should filter nulls.
 */
type EvalProvider = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'mistral' | 'openrouter'

// Exported for unit tests (same convention as the deterministic runners).
// Not part of the stable module API — callers should go through runEvalRun.
export async function generateForItem(
  promptContent: string,
  itemInput: Record<string, unknown>,
  provider: EvalProvider,
  model: string,
  apiKey: string,
  /** Azure resource origin (provider_keys.provider_metadata.resource_url).
   * Required when provider === 'azure'; ignored otherwise. */
  resourceUrl: string | null,
  /** Generation temperature (P1-5). Defaults to 0 at the run boundary for a
   * reproducible eval; was a hardcoded 0.7 before. */
  temperature: number,
): Promise<string | null> {
  // The dataset-item shape allows either `variables` (template substitution)
  // or `messages` (already-formatted chat). Translate to a single user
  // message string for the LLM call.
  let userContent: string
  if (itemInput['variables'] && typeof itemInput['variables'] === 'object') {
    // Variables are substituted into the prompt content. The judge sees
    // the response, not the substituted prompt — so this branch produces a
    // response based on the variable values + the prompt's template.
    const vars = itemInput['variables'] as Record<string, string>
    userContent = Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('\n')
  } else if (Array.isArray(itemInput['messages'])) {
    const msgs = itemInput['messages'] as Array<{ role: string; content: string }>
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    userContent = lastUser?.content ?? ''
  } else {
    return null
  }
  if (!userContent) return null

  try {
    if (provider === 'openai') {
      const res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(buildOpenAIBody(
          model,
          [{ role: 'system', content: promptContent }, { role: 'user', content: userContent }],
          { temperature, maxTokens: 1024 },
        )),
      })
      if (!res || !res.ok) return null
      const json = await res.json() as { choices: Array<{ message: { content: string } }> }
      return json.choices?.[0]?.message?.content ?? null
    }

    if (provider === 'mistral' || provider === 'openrouter') {
      const url = provider === 'mistral'
        ? 'https://api.mistral.ai/v1/chat/completions'
        : 'https://openrouter.ai/api/v1/chat/completions'
      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(buildOpenAIBody(
          model,
          [{ role: 'system', content: promptContent }, { role: 'user', content: userContent }],
          { temperature, maxTokens: 1024 },
        )),
      })
      if (!res || !res.ok) return null
      const json = await res.json() as { choices: Array<{ message: { content: string } }> }
      return json.choices?.[0]?.message?.content ?? null
    }

    if (provider === 'anthropic') {
      const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          temperature,
          system: promptContent,
          messages: [{ role: 'user', content: userContent }],
        }),
      })
      if (!res || !res.ok) return null
      const json = await res.json() as { content: Array<{ type: string; text: string }> }
      return json.content?.find((b) => b.type === 'text')?.text ?? null
    }

    if (provider === 'azure') {
      // Azure OpenAI v1 endpoint (Aug 2025+) is OpenAI-compatible: same body
      // shape, but the base URL is the per-key resource origin and auth uses
      // the `api-key` header instead of Bearer. Mirrors proxy/azure.ts.
      if (!resourceUrl) return null
      const res = await fetchWithRetry(`${resourceUrl}/openai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify(buildOpenAIBody(
          model,
          [{ role: 'system', content: promptContent }, { role: 'user', content: userContent }],
          { temperature, maxTokens: 1024 },
        )),
      })
      if (!res || !res.ok) return null
      const json = await res.json() as { choices: Array<{ message: { content: string } }> }
      return json.choices?.[0]?.message?.content ?? null
    }

    // Gemini
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: promptContent }] },
          contents: [{ role: 'user', parts: [{ text: userContent }] }],
          generationConfig: { temperature, maxOutputTokens: 1024 },
        }),
      },
    )
    if (!res || !res.ok) return null
    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  } catch {
    return null
  }
}

/**
 * Build the judge prompt. When a score_config is attached we switch
 * the response shape so the LLM emits the right primitive for the
 * config type. The legacy numeric prompt is preserved exactly when
 * score_config is NULL so existing evaluators behave bit-identically.
 */
// buildJudgePrompt + parseJudgeReply moved to ./eval-runners/judge-prompt.ts
// (imported and re-exported above for backward compatibility).

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

type JudgeProvider = JudgeConfig['judge_provider']

/**
 * Low-level judge call: send `prompt` to the judge model and return the raw
 * reply text + cost + tokens WITHOUT interpreting it. Shared by the absolute
 * (callJudge) and pairwise (callPairwiseJudge) paths so the five provider
 * integrations live in exactly one place. Returns null on any transport
 * failure (non-ok / network), which the callers treat as a dropped sample.
 *
 * We hit each vendor API directly (not our own /proxy) on purpose — eval-runner
 * runs server-side and these calls bypass the customer-facing proxy.
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
 * Exported for unit tests (see generateForItem note above). */
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
): Promise<JudgeOutcome | null> {
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
  // rows; typed paths carry the value_* columns straight through.
  const sc = config.score_config
  if (!sc || sc.data_type === 'NUMERIC') {
    const min = sc?.min_value ?? config.scale_min
    const max = sc?.max_value ?? config.scale_max
    const range = max - min || 1
    const raw = parsed.value_number ?? parsed.score ?? 0
    const normalised = (raw - min) / range
    return {
      score: normalised,
      value_number: normalised,
      value_string: null,
      value_boolean: null,
      reasoning: parsed.reasoning,
      cost: res.cost,
      tokens: res.tokens,
    }
  }
  return {
    score: null,
    value_number: parsed.value_number,
    value_string: parsed.value_string,
    value_boolean: parsed.value_boolean,
    reasoning: parsed.reasoning,
    cost: res.cost,
    tokens: res.tokens,
  }
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

/** Runs a small async pool with concurrency cap. */
async function pool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function run(): Promise<void> {
    for (;;) {
      const idx = next++
      if (idx >= items.length) return
      results[idx] = await worker(items[idx]!)
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  await Promise.all(runners)
  return results
}

interface RunInput {
  evalRunId: string
  organizationId: string
  evaluatorId: string
  /** null for trajectory runs (P2-11), which score traces by name. */
  promptVersionId: string | null
  source: 'production' | 'dataset'
  /** Required when source = 'dataset' */
  datasetId?: string | null
  sampleSize: number
  sampleFrom?: string | null
  sampleTo?: string | null
  /** P1-4: 'recent' (created_at DESC, default) keeps the legacy behaviour;
   * 'random' (ORDER BY rand()) draws a representative, non-recency-biased
   * sample. Production source only. */
  sampleStrategy?: 'recent' | 'random' | null
  /** P1-5: generation temperature for dataset runs. Defaults to 0 (reproducible). */
  generationTemperature?: number | null
  /**
   * When source = 'dataset', the prompt content must be executed against each
   * item's input to produce a response — THEN that response is judged.
   * (Scoring `expected_output` directly was the previous bug: it measured the
   *  curated golden answer, not whatever the prompt actually generates.)
   * These fields are required for dataset runs; ignored for production.
   */
  runProvider?: EvalProvider | null
  runModel?: string | null
  /** P1-7 (3/3): 'single' (default, absolute scoring) or 'pairwise' (A vs B
   * head-to-head). Pairwise requires source='dataset' + promptVersionBId. */
  mode?: 'single' | 'pairwise' | null
  /** The "B" prompt version compared against promptVersionId ("A"). Pairwise only. */
  promptVersionBId?: string | null
}

/** Result of one sample's scoring, shared between production and dataset paths. */
interface SampleOutcome extends JudgeOutcome {
  requestId: string | null
  datasetItemId: string | null
}

/**
 * Resolve + decrypt an active provider key for an org, returning the plaintext
 * key and (for Azure) its validated resource origin. Throws a clear message on
 * a missing key or an Azure key without a usable resource_url. Used by the
 * pairwise path (P1-7 3/3); the single path inlines equivalent logic.
 */
async function resolveProviderKey(
  organizationId: string,
  provider: EvalProvider,
  label: string,
): Promise<{ key: string; resourceUrl: string | null }> {
  const { data: pkRow, error } = await supabaseAdmin
    .from('provider_keys')
    .select('encrypted_key, provider_metadata')
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (error || !pkRow) throw new Error(`No active ${provider} provider key found for ${label}`)
  const key = await aes256Decrypt(pkRow.encrypted_key as string)
  if (!key) throw new Error(`Failed to decrypt ${label} provider key`)
  const meta = (pkRow.provider_metadata as Record<string, unknown> | null) ?? {}
  const resourceUrl = typeof meta['resource_url'] === 'string' ? meta['resource_url'] : null
  if (provider === 'azure') {
    if (!resourceUrl) throw new Error(`Azure ${label} provider key is missing resource_url — re-register it`)
    const safe = validateOutboundUrlSync(resourceUrl)
    if (!safe.ok) throw new Error(`Azure ${label} resource_url rejected: ${safe.message}`)
  }
  return { key, resourceUrl }
}

// ─── R-7 Phase 1: deterministic evaluator types ──────────────────────────
//
// Both runRegex and runJsonSchema are pure, sync, free of provider keys
// and side effects. The eval_run flow wraps them with sample fetch +
// eval_results INSERT + aggregate so the API surface stays the same as
// the llm_judge path.

// Deterministic runners (regex/json_schema) + runSimpleEvalRun moved to
// ./eval-runners/deterministic.ts (imported and re-exported above for
// backward compatibility with existing test imports).

/**
 * Main entry point. Executes the eval_run end-to-end and updates DB rows.
 * Designed to be invoked via `fireAndForget(c, runEvalRun(...))` so the HTTP
 * caller gets an immediate 202 while work continues in the background.
 */
export async function runEvalRun(input: RunInput): Promise<void> {
  const {
    evalRunId,
    organizationId,
    evaluatorId,
    promptVersionId,
    source,
    datasetId,
    sampleSize,
    sampleFrom,
    sampleTo,
    runProvider,
    runModel,
    sampleStrategy,
    generationTemperature,
    mode,
    promptVersionBId,
  } = input

  // Mark running
  await supabaseAdmin
    .from('eval_runs')
    .update({ status: 'running' })
    .eq('id', evalRunId)

  // 4B.2 — dogfood ourselves. Every eval run posts a trace to the
  // spanlens-team workspace so we see our own eval cost / latency /
  // error rate in the same /traces view our customers use. The handle
  // is created up front so per-sample spans can chain off its
  // creationPromise without a blocking await.
  const internalTrace = startInternalTrace('eval_run', {
    eval_run_id: evalRunId,
    evaluator_id: evaluatorId,
    organization_id: organizationId,
    source,
    sample_size: sampleSize,
  })

  try {
    // Load evaluator config. `score_config_id` is nullable — when NULL we
    // keep the legacy NUMERIC-only behaviour exactly so existing
    // evaluators don't change semantics overnight.
    //
    // R-7 Phase 1: also select `type` so we can route deterministic
    // evaluators (regex / json_schema) before the LLM-as-judge prelude.
    const { data: evaluator, error: evErr } = await supabaseAdmin
      .from('evaluators')
      .select('id, type, config, score_config_id')
      .eq('id', evaluatorId)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (evErr || !evaluator) {
      throw new Error('Evaluator not found')
    }

    // Deterministic types (regex / json_schema / exact_match / contains)
    // short-circuit before the LLM-as-judge config validation +
    // provider-key resolution. Dataset source is not yet supported for
    // these types — they score production responses synchronously.
    const DETERMINISTIC_TYPES: DeterministicEvaluatorType[] = ['regex', 'json_schema', 'exact_match', 'contains']
    if ((DETERMINISTIC_TYPES as string[]).includes(evaluator.type)) {
      if (source === 'dataset') {
        throw new Error(`evaluator type '${evaluator.type}' currently only supports source='production'`)
      }
      if (promptVersionId == null) throw new Error('promptVersionId is required for this evaluator type')
      await runSimpleEvalRun(
        evalRunId,
        organizationId,
        promptVersionId,
        sampleSize,
        sampleFrom,
        sampleTo,
        evaluator.type as DeterministicEvaluatorType,
        evaluator.config as unknown as RegexConfig | JsonSchemaConfig | ExactMatchConfig | ContainsConfig,
      )
      // Internal trace closes via the outer finally — note `samples` count
      // and aggregate the simple path produced via internalTrace.end below.
      return
    }

    // ── P2-11: agent trajectory evaluation ────────────────────────────────
    // Scores the whole agent trace (ordered spans) against a criterion, not a
    // single response. Targets traces by name (config.trace_name); no prompt
    // version. Numeric 0..1 score so avg_score + the 95% CI apply for free.
    if (evaluator.type === 'trajectory') {
      const trajConfig = evaluator.config as unknown as JudgeConfig & { trace_name?: string }
      if (!trajConfig?.criterion || !trajConfig?.judge_provider || !trajConfig?.judge_model) {
        throw new Error('Trajectory evaluator config missing required fields (criterion / judge_provider / judge_model)')
      }
      const traceName = typeof trajConfig.trace_name === 'string' ? trajConfig.trace_name.trim() : ''
      if (!traceName) throw new Error('Trajectory evaluator config missing trace_name')

      const judge = await resolveProviderKey(organizationId, trajConfig.judge_provider, 'judge')

      // Record what this run is scoring so the dashboard can label it before
      // the run finishes.
      await supabaseAdmin.from('eval_runs').update({ trace_name: traceName }).eq('id', evalRunId)

      // Sample the most recent N traces with this name (optional time window).
      let traceQuery = supabaseAdmin
        .from('traces')
        .select('id, name, status, duration_ms')
        .eq('organization_id', organizationId)
        .eq('name', traceName)
        .order('started_at', { ascending: false })
        .limit(sampleSize)
      if (sampleFrom) traceQuery = traceQuery.gte('started_at', sampleFrom)
      if (sampleTo) traceQuery = traceQuery.lte('started_at', sampleTo)
      const { data: traces, error: tracesErr } = await traceQuery
      if (tracesErr) throw new Error(`Trace fetch failed: ${tracesErr.message}`)

      if (!traces || traces.length === 0) {
        await supabaseAdmin
          .from('eval_runs')
          .update({
            status: 'completed',
            scored_count: 0,
            attempted_count: 0,
            failed_count: 0,
            avg_score: null,
            error: `No traces named "${traceName}" found in the selected window.`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', evalRunId)
        internalTrace.end({ status: 'completed', metadata: { scored_count: 0, mode: 'trajectory' } })
        return
      }

      type TrajResult = { traceId: string; score: number; reasoning: string; cost: number; tokens: number }
      const outcomes = await pool(traces, JUDGE_CONCURRENCY, async (tr): Promise<TrajResult | null> => {
        const span = internalTrace.startSpan('trajectory_judge', {
          spanType: 'llm',
          metadata: { judge_provider: trajConfig.judge_provider, judge_model: trajConfig.judge_model, trace_id: tr.id },
        })
        try {
          // Cap spans per trace so a runaway agent can't blow the prompt.
          const { data: spanRows, error: spansErr } = await supabaseAdmin
            .from('spans')
            .select('name, span_type, status, input, output, error_message, started_at')
            .eq('trace_id', tr.id)
            .eq('organization_id', organizationId)
            .order('started_at', { ascending: true })
            .limit(200)
          if (spansErr || !spanRows || spanRows.length === 0) {
            span.end({ status: 'error', errorMessage: 'no spans for trace' })
            return null
          }
          const trajSpans: TrajectorySpan[] = spanRows.map((s) => ({
            name: s.name as string,
            span_type: s.span_type as string,
            status: s.status as string,
            input: s.input,
            output: s.output,
            error_message: (s.error_message as string | null) ?? null,
            started_at: s.started_at as string,
          }))
          const text = serializeTrajectory(
            { name: tr.name as string, status: tr.status as string, duration_ms: (tr.duration_ms as number | null) ?? null },
            trajSpans,
          )
          if (!text) {
            span.end({ status: 'error', errorMessage: 'empty trajectory' })
            return null
          }
          const out = await callTrajectoryJudge(trajConfig, text, judge.key, judge.resourceUrl)
          if (!out) {
            span.end({ status: 'error', errorMessage: 'callTrajectoryJudge returned null' })
            return null
          }
          span.end({
            status: 'completed',
            output: { score: out.score, reasoning: out.reasoning },
            costUsd: out.cost,
            totalTokens: out.tokens,
          })
          return { traceId: tr.id as string, score: out.score, reasoning: out.reasoning, cost: out.cost, tokens: out.tokens }
        } catch (err) {
          span.end({ status: 'error', errorMessage: err instanceof Error ? err.message : 'trajectory judge threw' })
          return null
        }
      })

      const scoredTraj = outcomes.filter((o): o is TrajResult => o !== null)
      if (scoredTraj.length === 0) {
        await supabaseAdmin
          .from('eval_runs')
          .update({
            status: 'failed',
            scored_count: 0,
            attempted_count: traces.length,
            failed_count: traces.length,
            error: 'All trajectory judge calls failed. Check judge model name and provider key.',
            completed_at: new Date().toISOString(),
          })
          .eq('id', evalRunId)
        internalTrace.end({ status: 'error', errorMessage: 'All trajectory judge calls failed', metadata: { mode: 'trajectory' } })
        return
      }

      const trajScores = scoredTraj.map((s) => s.score)
      const trajAvg = trajScores.reduce((a, b) => a + b, 0) / trajScores.length
      const trajStddev = sampleStdDev(trajScores)
      const trajCost = scoredTraj.reduce((sum, s) => sum + s.cost, 0)

      const { error: insErr } = await supabaseAdmin.from('eval_results').insert(
        scoredTraj.map((s) => ({
          organization_id: organizationId,
          eval_run_id: evalRunId,
          request_id: null,
          dataset_item_id: null,
          trace_id: s.traceId,
          score: s.score,
          reasoning: s.reasoning,
          judge_cost_usd: s.cost,
          judge_tokens: s.tokens,
        })),
      )
      if (insErr) throw new Error(`Result insert failed: ${insErr.message}`)

      await supabaseAdmin
        .from('eval_runs')
        .update({
          status: 'completed',
          scored_count: scoredTraj.length,
          attempted_count: traces.length,
          failed_count: traces.length - scoredTraj.length,
          avg_score: trajAvg,
          score_stddev: trajStddev,
          total_cost_usd: trajCost,
          completed_at: new Date().toISOString(),
        })
        .eq('id', evalRunId)
      internalTrace.end({
        status: 'completed',
        metadata: { scored_count: scoredTraj.length, attempted_count: traces.length, avg_score: trajAvg, mode: 'trajectory' },
      })
      return
    }

    // Past this point every path (pairwise / judge / embedding, production +
    // dataset) needs a prompt version. Only trajectory runs are null, and they
    // returned above — narrow the type for the rest of the function.
    if (promptVersionId == null) throw new Error('promptVersionId is required for this run')

    // ── P1-7 (3/3): pairwise (A vs B) comparison run ──────────────────────
    // Compares two prompt versions head-to-head on the same dataset inputs.
    // Each comparison stores score = 1 (B wins) / 0 (A wins) / 0.5 (tie), so
    // avg_score is B's win-rate and the 95% CI machinery applies for free.
    if (mode === 'pairwise') {
      if (evaluator.type !== 'llm_judge') {
        throw new Error(`pairwise mode requires an llm_judge evaluator, got '${evaluator.type}'`)
      }
      if (source !== 'dataset') throw new Error('pairwise mode requires source = dataset')
      if (!datasetId) throw new Error('datasetId is required for a pairwise run')
      if (!promptVersionBId) throw new Error('promptVersionBId is required for a pairwise run')
      if (!runProvider || !runModel) {
        throw new Error('runProvider and runModel are required for a pairwise run')
      }

      const pairConfig = evaluator.config as unknown as JudgeConfig
      if (!pairConfig?.criterion || !pairConfig?.judge_provider || !pairConfig?.judge_model) {
        throw new Error('Evaluator config missing required fields (criterion / judge_provider / judge_model)')
      }

      const judge = await resolveProviderKey(organizationId, pairConfig.judge_provider, 'judge')
      const gen = await resolveProviderKey(organizationId, runProvider, 'prompt generation')

      // Resolve both versions' content.
      const loadContent = async (id: string): Promise<string> => {
        const { data, error } = await supabaseAdmin
          .from('prompt_versions')
          .select('content')
          .eq('id', id)
          .eq('organization_id', organizationId)
          .maybeSingle()
        if (error || !data) throw new Error(`Prompt version not found: ${id}`)
        return data.content as string
      }
      const contentA = await loadContent(promptVersionId)
      const contentB = await loadContent(promptVersionBId)

      const { data: items, error: itemsErr } = await supabaseAdmin
        .from('dataset_items')
        .select('id, input, expected_output')
        .eq('dataset_id', datasetId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(sampleSize)
      if (itemsErr) throw new Error(`Dataset items fetch failed: ${itemsErr.message}`)

      // Generate a response from BOTH versions for each item (capped pool).
      const genTemp = generationTemperature ?? 0
      type PairSample = { datasetItemId: string; respA: string; respB: string; expectedOutput: string | null }
      const generated = await pool(items ?? [], GENERATION_CONCURRENCY, async (i): Promise<PairSample | null> => {
        const input2 = i.input as Record<string, unknown>
        const [a, b] = await Promise.all([
          generateForItem(contentA, input2, runProvider, runModel, gen.key, gen.resourceUrl, genTemp),
          generateForItem(contentB, input2, runProvider, runModel, gen.key, gen.resourceUrl, genTemp),
        ])
        // Both must succeed — a comparison needs two responses.
        if (!a || !b) return null
        return { datasetItemId: i.id as string, respA: a, respB: b, expectedOutput: (i.expected_output as string | null) ?? null }
      })
      // Counterbalance position bias: alternate which response is shown first.
      const preparedPairs = generated
        .filter((g): g is PairSample => g !== null)
        .map((p, idx) => ({ ...p, swap: idx % 2 === 1 }))

      if (preparedPairs.length === 0) {
        await supabaseAdmin
          .from('eval_runs')
          .update({
            status: 'completed',
            scored_count: 0,
            attempted_count: 0,
            failed_count: 0,
            avg_score: null,
            a_wins: 0,
            b_wins: 0,
            ties: 0,
            error: 'No dataset items produced a response from both versions.',
            completed_at: new Date().toISOString(),
          })
          .eq('id', evalRunId)
        internalTrace.end({ status: 'completed', metadata: { scored_count: 0, mode: 'pairwise' } })
        return
      }

      type Comparison = { datasetItemId: string; winner: 'a' | 'b' | 'tie'; score: number; reasoning: string; cost: number; tokens: number }
      const comparisons = await pool(preparedPairs, JUDGE_CONCURRENCY, async (pair): Promise<Comparison | null> => {
        const span = internalTrace.startSpan('llm_judge_pairwise', {
          spanType: 'llm',
          metadata: {
            judge_provider: pairConfig.judge_provider,
            judge_model: pairConfig.judge_model,
            dataset_item_id: pair.datasetItemId,
            swapped: pair.swap,
          },
        })
        try {
          // `first` is shown as "A" in the prompt, `second` as "B".
          const first = pair.swap ? pair.respB : pair.respA
          const second = pair.swap ? pair.respA : pair.respB
          const out = await callPairwiseJudge(pairConfig, first, second, judge.key, judge.resourceUrl, pair.expectedOutput)
          if (!out) {
            span.end({ status: 'error', errorMessage: 'callPairwiseJudge returned null' })
            return null
          }
          // Map the prompt-side winner (A/B/tie) back to the real version,
          // undoing the swap.
          let winner: 'a' | 'b' | 'tie'
          if (out.winner === 'tie') winner = 'tie'
          else if (out.winner === 'A') winner = pair.swap ? 'b' : 'a'
          else winner = pair.swap ? 'a' : 'b'
          const score = winner === 'b' ? 1 : winner === 'a' ? 0 : 0.5
          span.end({
            status: 'completed',
            output: { winner, reasoning: out.reasoning },
            costUsd: out.cost,
            totalTokens: out.tokens,
          })
          return { datasetItemId: pair.datasetItemId, winner, score, reasoning: out.reasoning, cost: out.cost, tokens: out.tokens }
        } catch (err) {
          span.end({ status: 'error', errorMessage: err instanceof Error ? err.message : 'pairwise judge threw' })
          return null
        }
      })

      const scored = comparisons.filter((c): c is Comparison => c !== null)
      if (scored.length === 0) {
        await supabaseAdmin
          .from('eval_runs')
          .update({
            status: 'failed',
            scored_count: 0,
            attempted_count: preparedPairs.length,
            failed_count: preparedPairs.length,
            error: 'All pairwise judge calls failed. Check judge model name and provider key.',
            completed_at: new Date().toISOString(),
          })
          .eq('id', evalRunId)
        internalTrace.end({ status: 'error', errorMessage: 'All pairwise judge calls failed', metadata: { mode: 'pairwise' } })
        return
      }

      const aWins = scored.filter((s) => s.winner === 'a').length
      const bWins = scored.filter((s) => s.winner === 'b').length
      const ties = scored.filter((s) => s.winner === 'tie').length
      const scoreValues = scored.map((s) => s.score)
      const avgScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
      const scoreStddev = sampleStdDev(scoreValues)
      const totalCost = scored.reduce((sum, s) => sum + s.cost, 0)

      const { error: insErr } = await supabaseAdmin.from('eval_results').insert(
        scored.map((s) => ({
          organization_id: organizationId,
          eval_run_id: evalRunId,
          request_id: null,
          dataset_item_id: s.datasetItemId,
          score: s.score,
          winner: s.winner,
          reasoning: s.reasoning,
          judge_cost_usd: s.cost,
          judge_tokens: s.tokens,
        })),
      )
      if (insErr) throw new Error(`Result insert failed: ${insErr.message}`)

      await supabaseAdmin
        .from('eval_runs')
        .update({
          status: 'completed',
          scored_count: scored.length,
          attempted_count: preparedPairs.length,
          failed_count: preparedPairs.length - scored.length,
          avg_score: avgScore,
          score_stddev: scoreStddev,
          a_wins: aWins,
          b_wins: bWins,
          ties,
          total_cost_usd: totalCost,
          completed_at: new Date().toISOString(),
        })
        .eq('id', evalRunId)
      internalTrace.end({
        status: 'completed',
        metadata: { scored_count: scored.length, a_wins: aWins, b_wins: bWins, ties, avg_score: avgScore, mode: 'pairwise' },
      })
      return
    }

    // Judge and embedding both resolve a provider key (+ azure resource URL),
    // then share the sample gathering + scoring loop below. `config` (judge)
    // and `embedConfig` (embedding) are mutually exclusive; `scoringKey` /
    // `scoringResourceUrl` carry whichever applies into the scoring loop.
    const isEmbedding = evaluator.type === 'embedding'
    let config: JudgeConfig = {} as JudgeConfig
    let embedConfig: EmbeddingConfig | null = null
    let scoringKey: string
    let scoringResourceUrl: string | null = null

    if (isEmbedding) {
      embedConfig = evaluator.config as unknown as EmbeddingConfig
      if (!embedConfig?.provider || !embedConfig?.model) {
        throw new Error('Embedding evaluator config missing required fields (provider / model)')
      }
      if (!(EMBEDDING_PROVIDERS as string[]).includes(embedConfig.provider)) {
        throw new Error(`Unsupported embedding provider: ${embedConfig.provider}`)
      }
      const { data: pkRow, error: pkErr } = await supabaseAdmin
        .from('provider_keys')
        .select('id, provider, encrypted_key, provider_metadata')
        .eq('organization_id', organizationId)
        .eq('provider', embedConfig.provider)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (pkErr || !pkRow) {
        throw new Error(`No active ${embedConfig.provider} provider key found for embedding`)
      }
      const key = await aes256Decrypt(pkRow.encrypted_key as string)
      if (!key) throw new Error('Failed to decrypt embedding provider key')
      scoringKey = key
      const meta = (pkRow.provider_metadata as Record<string, unknown> | null) ?? {}
      scoringResourceUrl = typeof meta['resource_url'] === 'string' ? meta['resource_url'] : null
      if (embedConfig.provider === 'azure') {
        if (!scoringResourceUrl) {
          throw new Error('Azure embedding provider key is missing resource_url — re-register it')
        }
        const safe = validateOutboundUrlSync(scoringResourceUrl)
        if (!safe.ok) throw new Error(`Azure embedding resource_url rejected: ${safe.message}`)
      }
    } else {
    config = evaluator.config as unknown as JudgeConfig
    if (!config?.criterion || !config?.judge_provider || !config?.judge_model) {
      throw new Error('Evaluator config missing required fields (criterion / judge_provider / judge_model)')
    }

    // Resolve the optional typed score config. Fetch once up front so
    // every judge call carries the same definition (no per-sample
    // round-trips).
    if (evaluator.score_config_id) {
      const { data: sc } = await supabaseAdmin
        .from('score_configs')
        .select('id, data_type, min_value, max_value, categories, bool_true_label, bool_false_label')
        .eq('id', evaluator.score_config_id)
        .eq('organization_id', organizationId)
        .is('archived_at', null)
        .maybeSingle()
      if (sc) {
        config.score_config = {
          id: sc.id,
          data_type: sc.data_type as TypedScoreConfig['data_type'],
          min_value: sc.min_value,
          max_value: sc.max_value,
          categories: sc.categories,
          bool_true_label: sc.bool_true_label,
          bool_false_label: sc.bool_false_label,
        }
      }
      // If the config row was archived between evaluator creation and run
      // we silently fall through to the legacy NUMERIC path. The
      // evaluator-level rebuild UI is the proper place to surface
      // "config archived" warnings.
    }

    // Find an active provider key matching the judge provider. provider_metadata
    // carries Azure's resource_url (NULL for other providers).
    const { data: pkRow, error: pkErr } = await supabaseAdmin
      .from('provider_keys')
      .select('id, provider, encrypted_key, provider_metadata')
      .eq('organization_id', organizationId)
      .eq('provider', config.judge_provider)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (pkErr || !pkRow) {
      throw new Error(`No active ${config.judge_provider} provider key found for judge`)
    }

    const judgeKey = await aes256Decrypt(pkRow.encrypted_key as string)
    if (!judgeKey) throw new Error('Failed to decrypt judge provider key')

    // Azure needs the resource origin to build the upstream URL. Fail the whole
    // run with a clear message up front rather than letting every sample return
    // null (which would surface as the misleading "All judge calls failed").
    const judgeMeta = (pkRow.provider_metadata as Record<string, unknown> | null) ?? {}
    const judgeResourceUrl = typeof judgeMeta['resource_url'] === 'string' ? judgeMeta['resource_url'] : null
    if (config.judge_provider === 'azure') {
      if (!judgeResourceUrl) {
        throw new Error('Azure judge provider key is missing resource_url — re-register it')
      }
      // Defense-in-depth SSRF guard. resource_url is validated to an Azure
      // domain at registration (providerKeys.ts), but a direct DB write could
      // bypass that — re-check here before we send the decrypted key to it.
      const safe = validateOutboundUrlSync(judgeResourceUrl)
      if (!safe.ok) {
        throw new Error(`Azure judge resource_url rejected: ${safe.message}`)
      }
    }
      scoringKey = judgeKey
      scoringResourceUrl = judgeResourceUrl
    }

    // ── Gather samples (production requests OR dataset items) ──────────────
    type SampleRow = {
      responseText: string
      requestId: string | null
      datasetItemId: string | null
      /** P1-6: golden answer for dataset items; null for production samples. */
      expectedOutput: string | null
    }
    let preparedSamples: SampleRow[] = []

    if (source === 'production') {
      // Sample production responses for LLM-as-judge. response_body is a JSON
      // string in ClickHouse (vs JSONB in Supabase) — we parse it client-side
      // before passing to extractResponseText, which already handles unknown.
      const sampleFilters: string[] = [
        'prompt_version_id = {promptVersionId:UUID}',
        // response_body in ClickHouse is a non-null String (default '' for
        // missing). Filter out empties at the DB instead of pulling them back.
        "response_body != ''",
      ]
      const sampleParams: Record<string, unknown> = { promptVersionId }
      if (sampleFrom) {
        sampleFilters.push('created_at >= parseDateTime64BestEffort({sampleFrom:String})')
        sampleParams['sampleFrom'] = sampleFrom
      }
      if (sampleTo) {
        sampleFilters.push('created_at <= parseDateTime64BestEffort({sampleTo:String})')
        sampleParams['sampleTo'] = sampleTo
      }

      interface SampleQueryRow {
        id: string
        response_body: string
      }
      let samples: SampleQueryRow[]
      try {
        const scope = await requestsScope(organizationId)
        samples = await selectRequests<SampleQueryRow>({
          scope,
          select: 'id, response_body',
          filters: sampleFilters.join(' AND '),
          // P1-4: 'random' draws a representative sample (rand()); 'recent'
          // (default) preserves the legacy latest-N behaviour.
          orderBy: sampleStrategy === 'random' ? 'rand()' : 'created_at DESC',
          limit: sampleSize,
          params: sampleParams,
        })
      } catch (err) {
        throw new Error(`Sample fetch failed: ${err instanceof Error ? err.message : String(err)}`)
      }

      preparedSamples = samples
        .map((s) => {
          let parsed: unknown
          try {
            parsed = JSON.parse(s.response_body)
          } catch {
            parsed = s.response_body
          }
          return {
            responseText: extractResponseText(parsed) ?? '',
            requestId: s.id,
            datasetItemId: null,
            expectedOutput: null,
          }
        })
        .filter((s) => s.responseText.length > 0)
    } else {
      // source === 'dataset' — run the prompt against each item's input,
      // THEN score the generated response. expected_output is reference-only
      // (a future enhancement could feed it into the judge prompt as a target).
      if (!datasetId) throw new Error('datasetId is required when source = dataset')
      if (!runProvider || !runModel) {
        throw new Error('runProvider and runModel are required when source = dataset')
      }

      // 1. Resolve the prompt version's content + the run provider key
      const { data: pv, error: pvErr } = await supabaseAdmin
        .from('prompt_versions')
        .select('content')
        .eq('id', promptVersionId)
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (pvErr || !pv) throw new Error(`Prompt version not found: ${pvErr?.message ?? promptVersionId}`)
      const promptContent = pv.content as string

      const { data: runKeyRow, error: runKeyErr } = await supabaseAdmin
        .from('provider_keys')
        .select('encrypted_key, provider_metadata')
        .eq('organization_id', organizationId)
        .eq('provider', runProvider)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle()
      if (runKeyErr || !runKeyRow) {
        throw new Error(`No active ${runProvider} provider key found for prompt generation`)
      }
      const runApiKey = await aes256Decrypt(runKeyRow.encrypted_key as string)
      if (!runApiKey) throw new Error('Failed to decrypt run provider key')

      // Azure generation needs the resource origin (same as the judge path).
      const runMeta = (runKeyRow.provider_metadata as Record<string, unknown> | null) ?? {}
      const runResourceUrl = typeof runMeta['resource_url'] === 'string' ? runMeta['resource_url'] : null
      if (runProvider === 'azure') {
        if (!runResourceUrl) {
          throw new Error('Azure run provider key is missing resource_url — re-register it')
        }
        const safe = validateOutboundUrlSync(runResourceUrl)
        if (!safe.ok) {
          throw new Error(`Azure run resource_url rejected: ${safe.message}`)
        }
      }

      // 2. Fetch all items in the dataset. expected_output (P1-6) is the golden
      //    answer; items without one are still scorable on the criterion alone.
      const { data: items, error: itemsErr } = await supabaseAdmin
        .from('dataset_items')
        .select('id, input, expected_output')
        .eq('dataset_id', datasetId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(sampleSize)
      if (itemsErr) throw new Error(`Dataset items fetch failed: ${itemsErr.message}`)

      // 3. Generate a response for each item by running the prompt against its
      //    input. P1-5: capped at GENERATION_CONCURRENCY (was an uncapped
      //    Promise.all) and at temperature genTemp (default 0, reproducible).
      //    Failures (network, model rejection) are dropped — the eval still
      //    completes with whatever scored.
      const genTemp = generationTemperature ?? 0
      const generated = await pool(items ?? [], GENERATION_CONCURRENCY, async (i) => {
        const out = await generateForItem(
          promptContent,
          i.input as Record<string, unknown>,
          runProvider,
          runModel,
          runApiKey,
          runResourceUrl,
          genTemp,
        )
        return out
          ? {
              responseText: out,
              datasetItemId: i.id as string,
              expectedOutput: (i.expected_output as string | null) ?? null,
            }
          : null
      })

      preparedSamples = generated
        .filter(
          (g): g is { responseText: string; datasetItemId: string; expectedOutput: string | null } =>
            g !== null && g.responseText.length > 0,
        )
        .map((g) => ({
          responseText: g.responseText,
          requestId: null,
          datasetItemId: g.datasetItemId,
          expectedOutput: g.expectedOutput,
        }))
    }

    if (preparedSamples.length === 0) {
      await supabaseAdmin
        .from('eval_runs')
        .update({
          status: 'completed',
          scored_count: 0,
          attempted_count: 0,
          failed_count: 0,
          avg_score: null,
          error: source === 'dataset'
            ? 'Dataset has no items with expected_output. Add items first.'
            : null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', evalRunId)
      return
    }

    // Score each sample with the judge LLM. Each sample becomes one
    // `llm_judge` span under the eval_run trace so we can see per-call
    // cost / latency / token use in /traces. Span lifecycle is
    // intentionally outside the try/catch so a failed judge call still
    // gets ended with status='error' instead of leaving a dangling
    // LIVE span.
    const outcomes = await pool(preparedSamples, JUDGE_CONCURRENCY, async (sample): Promise<SampleOutcome | null> => {
      const span = internalTrace.startSpan(isEmbedding ? 'embedding' : 'llm_judge', {
        spanType: 'llm',
        metadata: {
          judge_provider: isEmbedding ? embedConfig!.provider : config.judge_provider,
          judge_model: isEmbedding ? embedConfig!.model : config.judge_model,
          request_id: sample.requestId,
          dataset_item_id: sample.datasetItemId,
        },
      })
      try {
        let outcome: JudgeOutcome | null
        if (isEmbedding) {
          // Reference: dataset golden answer wins, else the config default.
          const reference = sample.expectedOutput ?? embedConfig!.reference_text ?? null
          if (!reference) {
            span.end({ status: 'error', errorMessage: 'no reference (expected_output / reference_text)' })
            return null
          }
          outcome = await scoreEmbedding(embedConfig!, sample.responseText, reference, scoringKey, scoringResourceUrl)
        } else {
          outcome = await callJudge(config, sample.responseText, scoringKey, scoringResourceUrl, sample.expectedOutput)
        }
        if (!outcome) {
          span.end({ status: 'error', errorMessage: isEmbedding ? 'scoreEmbedding returned null' : 'callJudge returned null' })
          return null
        }
        span.end({
          status: 'completed',
          output: {
            score: outcome.score,
            value_number: outcome.value_number,
            value_string: outcome.value_string,
            value_boolean: outcome.value_boolean,
            reasoning: outcome.reasoning,
          },
          costUsd: outcome.cost,
          totalTokens: outcome.tokens,
        })
        return {
          requestId: sample.requestId,
          datasetItemId: sample.datasetItemId,
          ...outcome,
        }
      } catch (err) {
        span.end({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'callJudge threw',
        })
        return null
      }
    })

    const scored = outcomes.filter((o): o is SampleOutcome => o !== null)

    if (scored.length === 0) {
      await supabaseAdmin
        .from('eval_runs')
        .update({
          status: 'failed',
          scored_count: 0,
          attempted_count: preparedSamples.length,
          failed_count: preparedSamples.length,
          error: 'All judge calls failed. Check judge model name and provider key.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', evalRunId)
      internalTrace.end({
        status: 'error',
        errorMessage: 'All judge calls failed',
        metadata: { scored_count: 0, total_samples: preparedSamples.length },
      })
      return
    }

    // Persist per-sample results. Typed value columns are always set
    // from the JudgeOutcome — the legacy `score` column also gets the
    // normalised 0..1 value for NUMERIC (and NULL otherwise) so
    // pre-4B.1c dashboard queries (`AVG(score)`) keep working unchanged.
    const resultRows = scored.map((s) => ({
      organization_id: organizationId,
      eval_run_id: evalRunId,
      request_id: s.requestId,
      dataset_item_id: s.datasetItemId,
      score: s.score,
      reasoning: s.reasoning,
      judge_cost_usd: s.cost,
      judge_tokens: s.tokens,
      score_config_id: config.score_config?.id ?? null,
      value_number: s.value_number,
      value_string: s.value_string,
      value_boolean: s.value_boolean,
    }))

    const { error: insertErr } = await supabaseAdmin
      .from('eval_results')
      .insert(resultRows)

    if (insertErr) throw new Error(`Result insert failed: ${insertErr.message}`)

    const totalCost = scored.reduce((sum, s) => sum + s.cost, 0)
    // The 0..1 values that back avg_score, also reused for the P1-7
    // standard deviation / confidence interval. Empty for the typed configs
    // that don't aggregate as a mean (CATEGORICAL, TEXT) so the dashboard
    // renders a different summary instead of a misleading 0.50.
    //   NUMERIC (+ embedding / legacy NULL): the normalised 0..1 score.
    //   BOOLEAN: 1 for a pass, 0 for a fail → mean is the pass-rate, and the
    //            stddev of the 0/1 set is the binomial spread used for the CI.
    const scoreValues: number[] = (() => {
      const sc = config.score_config
      if (!sc || sc.data_type === 'NUMERIC') {
        return scored
          .map((s) => s.value_number ?? s.score)
          .filter((v): v is number => v != null)
      }
      if (sc.data_type === 'BOOLEAN') {
        return scored
          .map((s) => s.value_boolean)
          .filter((v): v is boolean => v != null)
          .map((b) => (b ? 1 : 0))
      }
      return []
    })()
    const avgScore = scoreValues.length > 0
      ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
      : null
    // P1-7: sample stddev backs the 95% CI rendered next to avg_score. NULL
    // when there are <2 numeric points or the type has no mean.
    const scoreStddev = sampleStdDev(scoreValues)

    await supabaseAdmin
      .from('eval_runs')
      .update({
        status: 'completed',
        scored_count: scored.length,
        attempted_count: preparedSamples.length,
        failed_count: preparedSamples.length - scored.length,
        avg_score: avgScore,
        score_stddev: scoreStddev,
        total_cost_usd: totalCost,
        completed_at: new Date().toISOString(),
      })
      .eq('id', evalRunId)
    internalTrace.end({
      status: 'completed',
      metadata: {
        scored_count: scored.length,
        attempted_count: preparedSamples.length,
        failed_count: preparedSamples.length - scored.length,
        total_samples: preparedSamples.length,
        avg_score: avgScore,
        score_stddev: scoreStddev,
        total_cost_usd: totalCost,
      },
    })
  } catch (err) {
    await supabaseAdmin
      .from('eval_runs')
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        completed_at: new Date().toISOString(),
      })
      .eq('id', evalRunId)
    internalTrace.end({
      status: 'error',
      errorMessage: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}

/** Input for startEvalRun — the subset POST /eval-runs and the auto-run hook share. */
export interface StartEvalRunInput {
  organizationId: string
  evaluatorId: string
  /** null for trajectory runs. The P2-10 auto-run hook never targets trajectory
   *  evaluators (they aren't prompt-bound), but keep this nullable for safety. */
  promptVersionId: string | null
  source: 'production' | 'dataset'
  datasetId?: string | null
  sampleSize: number
  sampleFrom?: string | null
  sampleTo?: string | null
  /** A provider string (validated upstream); cast to EvalProvider internally. */
  runProvider?: string | null
  runModel?: string | null
  sampleStrategy?: 'recent' | 'random' | null
  generationTemperature?: number | null
  createdBy?: string | null
  /** P1-7 (3/3): 'single' (default) or 'pairwise'. */
  mode?: 'single' | 'pairwise' | null
  /** The "B" prompt version for a pairwise run. */
  promptVersionBId?: string | null
}

/**
 * Insert an eval_runs row and kick the run off in the background via
 * fireAndForget. Shared by the manual POST /eval-runs and the
 * auto-run-on-version hook (P2-10). Returns the new run id, or null if the
 * insert failed (caller decides whether that's fatal).
 */
export async function startEvalRun(c: Context, input: StartEvalRunInput): Promise<{ id: string } | null> {
  const isPairwise = input.mode === 'pairwise'
  const { data: run, error } = await supabaseAdmin
    .from('eval_runs')
    .insert({
      organization_id: input.organizationId,
      evaluator_id: input.evaluatorId,
      prompt_version_id: input.promptVersionId ?? null,
      source: input.source,
      dataset_id: input.source === 'dataset' ? (input.datasetId ?? null) : null,
      sample_size: input.sampleSize,
      sample_from: input.source === 'production' ? (input.sampleFrom ?? null) : null,
      sample_to: input.source === 'production' ? (input.sampleTo ?? null) : null,
      status: 'pending',
      created_by: input.createdBy ?? null,
      mode: isPairwise ? 'pairwise' : 'single',
      // The DB CHECK forbids a pairwise row without its B version.
      prompt_version_b_id: isPairwise ? (input.promptVersionBId ?? null) : null,
    })
    .select('id')
    .single()
  if (error || !run) return null

  fireAndForget(c, runEvalRun({
    evalRunId: run.id,
    organizationId: input.organizationId,
    evaluatorId: input.evaluatorId,
    promptVersionId: input.promptVersionId,
    source: input.source,
    datasetId: input.datasetId ?? null,
    sampleSize: input.sampleSize,
    sampleFrom: input.sampleFrom ?? null,
    sampleTo: input.sampleTo ?? null,
    runProvider: (input.runProvider ?? null) as EvalProvider | null,
    runModel: input.runModel ?? null,
    sampleStrategy: input.sampleStrategy ?? null,
    generationTemperature: input.generationTemperature ?? null,
    mode: isPairwise ? 'pairwise' : 'single',
    promptVersionBId: input.promptVersionBId ?? null,
  }))
  return run
}

/** Convenience: estimate judge cost before running (rough heuristic). */
export function estimateJudgeCostUsd(sampleSize: number, judgeModel: string): number {
  // Conservative: assume ~800 input + 100 output tokens per sample
  const inputTokens = sampleSize * 800
  const outputTokens = sampleSize * 100
  const provider = judgeModel.startsWith('gpt-') ? 'openai' : 'anthropic'
  const cost = calculateCost(provider, judgeModel, { promptTokens: inputTokens, completionTokens: outputTokens })
  return cost?.totalCost ?? 0
}
