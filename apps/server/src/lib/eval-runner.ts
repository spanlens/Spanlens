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
import { aes256Decrypt } from './crypto.js'
import { calculateCost } from './cost.js'

const JUDGE_CONCURRENCY = 5
const MAX_RESPONSE_CHARS = 4000 // truncate long responses fed to judge

interface JudgeConfig {
  criterion: string
  judge_provider: 'openai' | 'anthropic'
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

  // Anthropic
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
  const { evalRunId, organizationId, evaluatorId, promptVersionId, source, datasetId, sampleSize, sampleFrom, sampleTo } = input

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
      let query = supabaseAdmin
        .from('requests')
        .select('id, response_body')
        .eq('organization_id', organizationId)
        .eq('prompt_version_id', promptVersionId)
        .not('response_body', 'is', null)
        .order('created_at', { ascending: false })
        .limit(sampleSize)

      if (sampleFrom) query = query.gte('created_at', sampleFrom)
      if (sampleTo) query = query.lte('created_at', sampleTo)

      const { data: samples, error: sampleErr } = await query
      if (sampleErr) throw new Error(`Sample fetch failed: ${sampleErr.message}`)

      preparedSamples = (samples ?? [])
        .map((s) => ({
          responseText: extractResponseText(s.response_body) ?? '',
          requestId: s.id as string,
          datasetItemId: null,
        }))
        .filter((s) => s.responseText.length > 0)
    } else {
      // source === 'dataset'
      if (!datasetId) throw new Error('datasetId is required when source = dataset')

      const { data: items, error: itemsErr } = await supabaseAdmin
        .from('dataset_items')
        .select('id, expected_output')
        .eq('dataset_id', datasetId)
        .eq('organization_id', organizationId)
        .not('expected_output', 'is', null)
        .order('created_at', { ascending: false })
        .limit(sampleSize)

      if (itemsErr) throw new Error(`Dataset items fetch failed: ${itemsErr.message}`)

      preparedSamples = (items ?? [])
        .filter((i) => typeof i.expected_output === 'string' && i.expected_output.length > 0)
        .map((i) => ({
          responseText: i.expected_output as string,
          requestId: null,
          datasetItemId: i.id as string,
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
