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

const JUDGE_CONCURRENCY = 5
const MAX_RESPONSE_CHARS = 4000 // truncate long responses fed to judge

interface JudgeConfig {
  criterion: string
  judge_provider: 'openai' | 'anthropic' | 'gemini'
  judge_model: string
  scale_min: number
  scale_max: number
}

interface JudgeOutcome {
  score: number          // normalized to 0..1
  reasoning: string
  cost: number
  tokens: number
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
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: promptContent },
            { role: 'user', content: userContent },
          ],
          temperature: 0.7,
          max_tokens: 1024,
        }),
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

/** Builds the judge prompt asking it to score `responseText` against `criterion`. */
function buildJudgePrompt(criterion: string, responseText: string, scaleMin: number, scaleMax: number): string {
  const truncated = responseText.length > MAX_RESPONSE_CHARS
    ? responseText.slice(0, MAX_RESPONSE_CHARS) + '… [truncated]'
    : responseText

  return `You are an evaluator. Score the assistant response below against this criterion.

Criterion: ${criterion}

Response to evaluate:
"""
${truncated}
"""

Reply ONLY in JSON with this exact shape:
{"score": <number between ${scaleMin} and ${scaleMax}>, "reasoning": "<one short sentence>"}

No prose outside the JSON. No markdown fences.`
}

/** Parses the judge's JSON reply, tolerating common formatting drift. */
function parseJudgeReply(text: string, scaleMin: number, scaleMax: number): { score: number; reasoning: string } | null {
  // Strip markdown fences if present
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  }

  try {
    const parsed = JSON.parse(cleaned) as { score?: unknown; reasoning?: unknown }
    const rawScore = typeof parsed.score === 'number' ? parsed.score : Number(parsed.score)
    if (!Number.isFinite(rawScore)) return null
    const clamped = Math.max(scaleMin, Math.min(scaleMax, rawScore))
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : ''
    return { score: clamped, reasoning }
  } catch {
    return null
  }
}

/** Calls the judge LLM once. Returns null on failure (caller skips the sample). */
async function callJudge(
  config: JudgeConfig,
  responseText: string,
  apiKey: string,
): Promise<JudgeOutcome | null> {
  const prompt = buildJudgePrompt(config.criterion, responseText, config.scale_min, config.scale_max)

  if (config.judge_provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.judge_model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) return null
    const json = await res.json() as {
      choices: Array<{ message: { content: string } }>
      usage: { prompt_tokens: number; completion_tokens: number }
      model: string
    }
    const text = json.choices?.[0]?.message?.content ?? ''
    const parsed = parseJudgeReply(text, config.scale_min, config.scale_max)
    if (!parsed) return null
    const tokens = (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0)
    const cost = calculateCost('openai', json.model ?? config.judge_model, {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    })?.totalCost ?? 0
    // Normalize to 0..1
    const range = config.scale_max - config.scale_min || 1
    return {
      score: (parsed.score - config.scale_min) / range,
      reasoning: parsed.reasoning,
      cost,
      tokens,
    }
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
    const parsed = parseJudgeReply(text, config.scale_min, config.scale_max)
    if (!parsed) return null
    const tokens = (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0)
    const cost = calculateCost('anthropic', json.model ?? config.judge_model, {
      promptTokens: json.usage?.input_tokens ?? 0,
      completionTokens: json.usage?.output_tokens ?? 0,
    })?.totalCost ?? 0
    const range = config.scale_max - config.scale_min || 1
    return {
      score: (parsed.score - config.scale_min) / range,
      reasoning: parsed.reasoning,
      cost,
      tokens,
    }
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
          responseSchema: {
            type: 'object',
            properties: {
              score: { type: 'number' },
              reasoning: { type: 'string' },
            },
            required: ['score', 'reasoning'],
          },
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
  const geminiParsed = parseJudgeReply(geminiText, config.scale_min, config.scale_max)
  if (!geminiParsed) return null
  const geminiTokens =
    (geminiJson.usageMetadata?.promptTokenCount ?? 0) +
    (geminiJson.usageMetadata?.candidatesTokenCount ?? 0)
  const geminiCost = calculateCost('gemini', geminiJson.modelVersion ?? config.judge_model, {
    promptTokens: geminiJson.usageMetadata?.promptTokenCount ?? 0,
    completionTokens: geminiJson.usageMetadata?.candidatesTokenCount ?? 0,
  })?.totalCost ?? 0
  const geminiRange = config.scale_max - config.scale_min || 1
  return {
    score: (geminiParsed.score - config.scale_min) / geminiRange,
    reasoning: geminiParsed.reasoning,
    cost: geminiCost,
    tokens: geminiTokens,
  }
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
    // Load evaluator config
    const { data: evaluator, error: evErr } = await supabaseAdmin
      .from('evaluators')
      .select('id, config')
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

    // Persist per-sample results
    const resultRows = scored.map((s) => ({
      organization_id: organizationId,
      eval_run_id: evalRunId,
      request_id: s.requestId,
      dataset_item_id: s.datasetItemId,
      score: s.score,
      reasoning: s.reasoning,
      judge_cost_usd: s.cost,
      judge_tokens: s.tokens,
    }))

    const { error: insertErr } = await supabaseAdmin
      .from('eval_results')
      .insert(resultRows)

    if (insertErr) throw new Error(`Result insert failed: ${insertErr.message}`)

    const totalCost = scored.reduce((sum, s) => sum + s.cost, 0)
    const avgScore = scored.reduce((sum, s) => sum + s.score, 0) / scored.length

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
