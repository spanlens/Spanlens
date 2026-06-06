/**
 * LLM-as-judge evaluation runner.
 *
 * Executes an eval_run by:
 *   1. Fetching the evaluator + prompt_version
 *   2. Sampling N requests from production for that prompt_version
 *   3. Calling the judge LLM (using the user's provider key) on each sample
 *   4. Persisting per-sample scores + aggregate
 *
 * Concurrency: processes samples in a small concurrency window (default 5)
 * to avoid burning rate limits while keeping latency reasonable.
 */

import { supabaseAdmin } from './db.js'
import { requestsScope, selectRequests } from './requests-query.js'
import { aes256Decrypt } from './crypto.js'
import { calculateCost } from './cost.js'
import { buildOpenAIBody } from './playground-runner.js'

const JUDGE_CONCURRENCY = 5
const MAX_RESPONSE_CHARS = 4000 // truncate long responses fed to judge

interface JudgeConfig {
  criterion: string
  judge_provider: 'openai' | 'anthropic' | 'gemini'
  judge_model: string
  scale_min: number
  scale_max: number
  // 4B.1c — optional pointer at a workspace score_config. When NULL we
  // preserve the legacy NUMERIC 0..1 behaviour exactly: the judge is
  // asked for a number in [scale_min, scale_max], the result clamps and
  // normalises to 0..1, and only the `score` column is filled. When
  // non-NULL we route through the type-aware prompt + parser below.
  score_config?: TypedScoreConfig | null
}

/**
 * Minimal projection of the score_configs row that the runner actually
 * needs. Mirrors the shape used by `lib/score-validation.ts` so we can
 * share the validator without re-fetching.
 */
export interface TypedScoreConfig {
  id: string
  data_type: 'NUMERIC' | 'CATEGORICAL' | 'BOOLEAN' | 'TEXT'
  min_value: number | null
  max_value: number | null
  categories: unknown
  bool_true_label: string | null
  bool_false_label: string | null
}

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

/** Extracts the assistant response text from a stored response_body. */
function extractResponseText(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const obj = body as Record<string, unknown>

  // OpenAI chat completion
  const choices = obj.choices as Array<Record<string, unknown>> | undefined
  if (Array.isArray(choices) && choices[0]) {
    const msg = choices[0].message as Record<string, unknown> | undefined
    const content = typeof msg?.content === 'string' ? msg.content : null
    if (content) return content
  }

  // Anthropic messages
  const content = obj.content as Array<Record<string, unknown>> | undefined
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === 'text')
    if (textBlock && typeof textBlock.text === 'string') return textBlock.text
  }

  // Gemini
  const candidates = obj.candidates as Array<Record<string, unknown>> | undefined
  if (Array.isArray(candidates) && candidates[0]) {
    const candidate = candidates[0]
    const cContent = candidate.content as Record<string, unknown> | undefined
    const parts = cContent?.parts as Array<Record<string, unknown>> | undefined
    if (Array.isArray(parts) && parts[0] && typeof parts[0].text === 'string') {
      return parts[0].text
    }
  }

  return null
}

/**
 * Generate a response for a dataset item by running the supplied prompt
 * content + the item's input through the chosen provider. Mirrors the
 * runPrompt() helper in experiment-runner.ts (intentionally inlined here
 * to avoid the runner-to-runner import cycle).
 *
 * Returns the assistant text on success, null on any failure (network,
 * 4xx/5xx, empty output). Callers should filter nulls.
 */
async function generateForItem(
  promptContent: string,
  itemInput: Record<string, unknown>,
  provider: 'openai' | 'anthropic' | 'gemini',
  model: string,
  apiKey: string,
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
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify(buildOpenAIBody(
          model,
          [{ role: 'system', content: promptContent }, { role: 'user', content: userContent }],
          { temperature: 0.7, maxTokens: 1024 },
        )),
      })
      if (!res.ok) return null
      const json = await res.json() as { choices: Array<{ message: { content: string } }> }
      return json.choices?.[0]?.message?.content ?? null
    }

    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          temperature: 0.7,
          system: promptContent,
          messages: [{ role: 'user', content: userContent }],
        }),
      })
      if (!res.ok) return null
      const json = await res.json() as { content: Array<{ type: string; text: string }> }
      return json.content?.find((b) => b.type === 'text')?.text ?? null
    }

    // Gemini
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: promptContent }] },
          contents: [{ role: 'user', parts: [{ text: userContent }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
        }),
      },
    )
    if (!res.ok) return null
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
export function buildJudgePrompt(
  criterion: string,
  responseText: string,
  config: { scale_min: number; scale_max: number; score_config?: TypedScoreConfig | null },
): string {
  const truncated = responseText.length > MAX_RESPONSE_CHARS
    ? responseText.slice(0, MAX_RESPONSE_CHARS) + '… [truncated]'
    : responseText

  const intro = `You are an evaluator. Score the assistant response below against this criterion.

Criterion: ${criterion}

Response to evaluate:
"""
${truncated}
"""`

  const sc = config.score_config

  // Legacy NUMERIC path — unchanged from before 4B.1c.
  if (!sc || sc.data_type === 'NUMERIC') {
    const min = sc?.min_value ?? config.scale_min
    const max = sc?.max_value ?? config.scale_max
    return `${intro}

Reply ONLY in JSON with this exact shape:
{"score": <number between ${min} and ${max}>, "reasoning": "<one short sentence>"}

No prose outside the JSON. No markdown fences.`
  }

  if (sc.data_type === 'BOOLEAN') {
    const trueLabel = sc.bool_true_label ?? 'pass'
    const falseLabel = sc.bool_false_label ?? 'fail'
    return `${intro}

Reply ONLY in JSON with this exact shape:
{"value": <true or false>, "reasoning": "<one short sentence>"}

\`true\` means "${trueLabel}", \`false\` means "${falseLabel}". No prose outside the JSON. No markdown fences.`
  }

  if (sc.data_type === 'CATEGORICAL') {
    const cats = Array.isArray(sc.categories)
      ? sc.categories.filter((c): c is string => typeof c === 'string')
      : []
    return `${intro}

Reply ONLY in JSON with this exact shape:
{"value": "<one of: ${cats.map((c) => JSON.stringify(c)).join(', ')}>", "reasoning": "<one short sentence>"}

The \`value\` MUST be one of the categories above, exact case match. No prose outside the JSON. No markdown fences.`
  }

  // TEXT — judge writes a free-form short answer.
  return `${intro}

Reply ONLY in JSON with this exact shape:
{"value": "<short answer>", "reasoning": "<one short sentence>"}

Keep \`value\` under 200 characters. No prose outside the JSON. No markdown fences.`
}

/**
 * Parse the judge's JSON reply into the right typed column. Falls back
 * to NUMERIC parsing (clamp + normalise to 0..1) when score_config is
 * absent or NUMERIC, which preserves the legacy behaviour exactly.
 */
export function parseJudgeReply(
  text: string,
  config: { scale_min: number; scale_max: number; score_config?: TypedScoreConfig | null },
): {
  score: number | null
  value_number: number | null
  value_string: string | null
  value_boolean: boolean | null
  reasoning: string
} | null {
  // Strip markdown fences if present.
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  }

  let parsed: { score?: unknown; value?: unknown; reasoning?: unknown }
  try {
    parsed = JSON.parse(cleaned) as typeof parsed
  } catch {
    return null
  }
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : ''
  const sc = config.score_config

  // Legacy / explicit NUMERIC path. Keep the prior clamp + normalise so
  // result-table aggregations stay backwards compatible.
  if (!sc || sc.data_type === 'NUMERIC') {
    // Accept either {score: number} (legacy) or {value: number} (new),
    // so an LLM that drifts between the two formats still works.
    const raw = parsed.score ?? parsed.value
    const numeric = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(numeric)) return null
    const min = sc?.min_value ?? config.scale_min
    const max = sc?.max_value ?? config.scale_max
    const clamped = Math.max(min, Math.min(max, numeric))
    return {
      score: clamped, // legacy column — same value as the new path filled below
      value_number: clamped,
      value_string: null,
      value_boolean: null,
      reasoning,
    }
  }

  if (sc.data_type === 'BOOLEAN') {
    const raw = parsed.value
    let normalised: boolean | null = null
    if (typeof raw === 'boolean') normalised = raw
    else if (raw === 'true' || raw === 'pass' || raw === 'yes') normalised = true
    else if (raw === 'false' || raw === 'fail' || raw === 'no') normalised = false
    if (normalised === null) return null
    return {
      score: null,
      value_number: null,
      value_string: null,
      value_boolean: normalised,
      reasoning,
    }
  }

  if (sc.data_type === 'CATEGORICAL') {
    const raw = parsed.value
    if (typeof raw !== 'string' || raw.length === 0) return null
    const cats = Array.isArray(sc.categories)
      ? sc.categories.filter((c): c is string => typeof c === 'string')
      : []
    if (!cats.includes(raw)) return null
    return {
      score: null,
      value_number: null,
      value_string: raw,
      value_boolean: null,
      reasoning,
    }
  }

  // TEXT — accept any non-empty string, trim it. The judge has been
  // told to keep it under 200 chars; we don't strictly enforce on read
  // since human reviewers might prefer the long version.
  const raw = parsed.value
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return {
    score: null,
    value_number: null,
    value_string: trimmed,
    value_boolean: null,
    reasoning,
  }
}

/** Calls the judge LLM once. Returns null on failure (caller skips the sample). */
async function callJudge(
  config: JudgeConfig,
  responseText: string,
  apiKey: string,
): Promise<JudgeOutcome | null> {
  const prompt = buildJudgePrompt(config.criterion, responseText, {
    scale_min: config.scale_min,
    scale_max: config.scale_max,
    score_config: config.score_config ?? null,
  })

  // Helper that turns a parsed judge reply into the JudgeOutcome the
  // caller stores. NUMERIC and legacy paths normalise into 0..1 so the
  // `score` column stays consistent with pre-4B.1c rows.
  function buildOutcome(
    parsed: NonNullable<ReturnType<typeof parseJudgeReply>>,
    cost: number,
    tokens: number,
  ): JudgeOutcome {
    const sc = config.score_config
    if (!sc || sc.data_type === 'NUMERIC') {
      // Legacy: clamp + normalise to 0..1 against scale_min / scale_max.
      // parseJudgeReply already returned a clamped value, so we just
      // shift + scale here.
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
        cost,
        tokens,
      }
    }
    // Typed paths — value columns are already populated by the parser.
    return {
      score: null,
      value_number: parsed.value_number,
      value_string: parsed.value_string,
      value_boolean: parsed.value_boolean,
      reasoning: parsed.reasoning,
      cost,
      tokens,
    }
  }

  if (config.judge_provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildOpenAIBody(
        config.judge_model,
        [{ role: 'user', content: prompt }],
        { temperature: 0, maxTokens: 200, responseFormat: { type: 'json_object' } },
      )),
    })
    if (!res.ok) return null
    const json = await res.json() as {
      choices: Array<{ message: { content: string } }>
      usage: { prompt_tokens: number; completion_tokens: number }
      model: string
    }
    const text = json.choices?.[0]?.message?.content ?? ''
    const parsed = parseJudgeReply(text, {
      scale_min: config.scale_min,
      scale_max: config.scale_max,
      score_config: config.score_config ?? null,
    })
    if (!parsed) return null
    const tokens = (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0)
    const cost = calculateCost('openai', json.model ?? config.judge_model, {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    })?.totalCost ?? 0
    return buildOutcome(parsed, cost, tokens)
  }

  if (config.judge_provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.judge_model,
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) return null
    const json = await res.json() as {
      content: Array<{ type: string; text: string }>
      usage: { input_tokens: number; output_tokens: number }
      model: string
    }
    const text = json.content?.find((b) => b.type === 'text')?.text ?? ''
    const parsed = parseJudgeReply(text, {
      scale_min: config.scale_min,
      scale_max: config.scale_max,
      score_config: config.score_config ?? null,
    })
    if (!parsed) return null
    const tokens = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0)
    const cost = calculateCost('anthropic', json.model ?? config.judge_model, {
      promptTokens: json.usage?.input_tokens ?? 0,
      completionTokens: json.usage?.output_tokens ?? 0,
    })?.totalCost ?? 0
    return buildOutcome(parsed, cost, tokens)
  }

  // Gemini — JSON output enforced via responseMimeType + responseSchema. This
  // matches OpenAI's `response_format: json_object` strictness so the judge
  // reply is always parseable. We hit `generateContent` directly (not our
  // /proxy) because eval-runner runs on the server — calls to api.openai.com
  // and generativelanguage.googleapis.com bypass our own proxy on purpose.
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.judge_model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
          // The Gemini responseSchema MUST match the prompt we ship for
          // the active score config or the model returns a schema error.
          // For BOOLEAN / CATEGORICAL / TEXT we ask for `value`; for
          // legacy NUMERIC we keep `score` so old runs are byte-identical.
          responseSchema: (() => {
            const sc = config.score_config
            if (!sc || sc.data_type === 'NUMERIC') {
              return {
                type: 'object',
                properties: {
                  score: { type: 'number' },
                  reasoning: { type: 'string' },
                },
                required: ['score', 'reasoning'],
              }
            }
            if (sc.data_type === 'BOOLEAN') {
              return {
                type: 'object',
                properties: {
                  value: { type: 'boolean' },
                  reasoning: { type: 'string' },
                },
                required: ['value', 'reasoning'],
              }
            }
            // CATEGORICAL + TEXT both emit strings; the parser validates
            // CATEGORICAL against the allow-list afterwards.
            return {
              type: 'object',
              properties: {
                value: { type: 'string' },
                reasoning: { type: 'string' },
              },
              required: ['value', 'reasoning'],
            }
          })(),
        },
      }),
    },
  )
  if (!geminiRes.ok) return null
  const geminiJson = await geminiRes.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    modelVersion?: string
  }
  const geminiText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const geminiParsed = parseJudgeReply(geminiText, {
    scale_min: config.scale_min,
    scale_max: config.scale_max,
    score_config: config.score_config ?? null,
  })
  if (!geminiParsed) return null
  const geminiTokens =
    (geminiJson.usageMetadata?.promptTokenCount ?? 0) +
    (geminiJson.usageMetadata?.candidatesTokenCount ?? 0)
  const geminiCost = calculateCost('gemini', geminiJson.modelVersion ?? config.judge_model, {
    promptTokens: geminiJson.usageMetadata?.promptTokenCount ?? 0,
    completionTokens: geminiJson.usageMetadata?.candidatesTokenCount ?? 0,
  })?.totalCost ?? 0
  return buildOutcome(geminiParsed, geminiCost, geminiTokens)
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
  promptVersionId: string
  source: 'production' | 'dataset'
  /** Required when source = 'dataset' */
  datasetId?: string | null
  sampleSize: number
  sampleFrom?: string | null
  sampleTo?: string | null
  /**
   * When source = 'dataset', the prompt content must be executed against each
   * item's input to produce a response — THEN that response is judged.
   * (Scoring `expected_output` directly was the previous bug: it measured the
   *  curated golden answer, not whatever the prompt actually generates.)
   * These fields are required for dataset runs; ignored for production.
   */
  runProvider?: 'openai' | 'anthropic' | 'gemini' | null
  runModel?: string | null
}

/** Result of one sample's scoring, shared between production and dataset paths. */
interface SampleOutcome extends JudgeOutcome {
  requestId: string | null
  datasetItemId: string | null
}

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
  } = input

  // Mark running
  await supabaseAdmin
    .from('eval_runs')
    .update({ status: 'running' })
    .eq('id', evalRunId)

  try {
    // Load evaluator config. `score_config_id` is nullable — when NULL we
    // keep the legacy NUMERIC-only behaviour exactly so existing
    // evaluators don't change semantics overnight.
    const { data: evaluator, error: evErr } = await supabaseAdmin
      .from('evaluators')
      .select('id, config, score_config_id')
      .eq('id', evaluatorId)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (evErr || !evaluator) {
      throw new Error('Evaluator not found')
    }

    const config = evaluator.config as unknown as JudgeConfig
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

    // Find an active provider key matching the judge provider
    const { data: pkRow, error: pkErr } = await supabaseAdmin
      .from('provider_keys')
      .select('id, provider, encrypted_key')
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

    // ── Gather samples (production requests OR dataset items) ──────────────
    type SampleRow = {
      responseText: string
      requestId: string | null
      datasetItemId: string | null
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
          orderBy: 'created_at DESC',
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
        .select('encrypted_key')
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

      // 2. Fetch all items in the dataset (no expected_output filter — we
      //    generate fresh responses, so items without a golden answer are
      //    still scorable on the criterion alone)
      const { data: items, error: itemsErr } = await supabaseAdmin
        .from('dataset_items')
        .select('id, input')
        .eq('dataset_id', datasetId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(sampleSize)
      if (itemsErr) throw new Error(`Dataset items fetch failed: ${itemsErr.message}`)

      // 3. Generate a response for each item by running the prompt against
      //    its input. Failures (network, model rejection) are dropped — the
      //    eval still completes with whatever scored.
      const generated = await Promise.all(
        (items ?? []).map(async (i) => {
          const out = await generateForItem(
            promptContent,
            i.input as Record<string, unknown>,
            runProvider,
            runModel,
            runApiKey,
          )
          return out ? { responseText: out, datasetItemId: i.id as string } : null
        }),
      )

      preparedSamples = generated
        .filter((g): g is { responseText: string; datasetItemId: string } => g !== null && g.responseText.length > 0)
        .map((g) => ({
          responseText: g.responseText,
          requestId: null,
          datasetItemId: g.datasetItemId,
        }))
    }

    if (preparedSamples.length === 0) {
      await supabaseAdmin
        .from('eval_runs')
        .update({
          status: 'completed',
          scored_count: 0,
          avg_score: null,
          error: source === 'dataset'
            ? 'Dataset has no items with expected_output. Add items first.'
            : null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', evalRunId)
      return
    }

    // Score each sample with the judge LLM
    const outcomes = await pool(preparedSamples, JUDGE_CONCURRENCY, async (sample): Promise<SampleOutcome | null> => {
      try {
        const outcome = await callJudge(config, sample.responseText, judgeKey)
        if (!outcome) return null
        return {
          requestId: sample.requestId,
          datasetItemId: sample.datasetItemId,
          ...outcome,
        }
      } catch {
        return null
      }
    })

    const scored = outcomes.filter((o): o is SampleOutcome => o !== null)

    if (scored.length === 0) {
      await supabaseAdmin
        .from('eval_runs')
        .update({
          status: 'failed',
          error: 'All judge calls failed. Check judge model name and provider key.',
          completed_at: new Date().toISOString(),
        })
        .eq('id', evalRunId)
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
    // `eval_runs.avg_score` is a NUMERIC summary. For typed configs that
    // don't aggregate as an average (CATEGORICAL, BOOLEAN, TEXT) we
    // emit a derived 0..1 number where it has a natural meaning
    // (BOOLEAN pass-rate) and NULL otherwise so the dashboard knows to
    // render a different summary instead of a misleading 0.50.
    const avgScore = (() => {
      const sc = config.score_config
      if (!sc || sc.data_type === 'NUMERIC') {
        const numericValues = scored
          .map((s) => s.value_number ?? s.score)
          .filter((v): v is number => v != null)
        if (numericValues.length === 0) return null
        return numericValues.reduce((a, b) => a + b, 0) / numericValues.length
      }
      if (sc.data_type === 'BOOLEAN') {
        const bools = scored
          .map((s) => s.value_boolean)
          .filter((v): v is boolean => v != null)
        if (bools.length === 0) return null
        const passes = bools.filter(Boolean).length
        return passes / bools.length
      }
      return null
    })()

    await supabaseAdmin
      .from('eval_runs')
      .update({
        status: 'completed',
        scored_count: scored.length,
        avg_score: avgScore,
        total_cost_usd: totalCost,
        completed_at: new Date().toISOString(),
      })
      .eq('id', evalRunId)
  } catch (err) {
    await supabaseAdmin
      .from('eval_runs')
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        completed_at: new Date().toISOString(),
      })
      .eq('id', evalRunId)
  }
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
