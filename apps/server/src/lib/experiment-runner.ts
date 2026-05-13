/**
 * Experiment runner — offline side-by-side comparison of two prompt versions.
 *
 * For each dataset item:
 *   1. Interpolate item.input.variables into prompt content (both versions)
 *   2. Run BOTH versions through the configured run_model
 *   3. Optionally judge each output with the evaluator
 *   4. Persist outputs + scores per item
 *
 * Concurrency: items processed in a small pool. Within each item, the two arms
 * run in parallel.
 */

import { supabaseAdmin } from './db.js'
import { aes256Decrypt } from './crypto.js'
import { calculateCost } from './cost.js'
import { interpolate } from './playground-runner.js'

const ITEM_CONCURRENCY = 3
const MAX_TOKENS = 1024
const TEMPERATURE = 0.7

// JudgeConfig kept in sync with eval-runner.ts. Inlined to avoid circular imports.
interface JudgeConfig {
  criterion: string
  judge_provider: 'openai' | 'anthropic'
  judge_model: string
  scale_min: number
  scale_max: number
}

interface RunResult {
  output: string
  cost: number
  latencyMs: number
  tokens: number
}

interface JudgeResult {
  score: number
  reasoning: string
  cost: number
  tokens: number
}

interface DatasetItemRow {
  id: string
  input: { variables?: Record<string, string>; messages?: Array<{ role: string; content: string }> }
}

interface PromptVersionRow {
  id: string
  content: string
}

// ── Prompt execution ────────────────────────────────────────────────────────

async function runPrompt(
  content: string,
  item: DatasetItemRow,
  provider: 'openai' | 'anthropic',
  model: string,
  apiKey: string,
): Promise<RunResult | { error: string }> {
  // Build the user content for the LLM call.
  // If item has messages, the last user message is interpolated against the prompt content.
  // If item has variables, interpolate the prompt content directly.
  let userContent: string
  if (item.input.variables) {
    const { result } = interpolate(content, item.input.variables)
    userContent = result
  } else if (item.input.messages && item.input.messages.length > 0) {
    const lastUser = [...item.input.messages].reverse().find((m) => m.role === 'user')
    userContent = lastUser?.content ?? ''
    if (!userContent) return { error: 'Item has no user message' }
  } else {
    return { error: 'Item input has neither variables nor messages' }
  }

  const startMs = Date.now()
  try {
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content }, { role: 'user', content: userContent }],
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
        }),
      })
      const latencyMs = Date.now() - startMs
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { error: `OpenAI error (${res.status}): ${text.slice(0, 200)}` }
      }
      const json = await res.json() as {
        choices: Array<{ message: { content: string } }>
        usage: { prompt_tokens: number; completion_tokens: number }
        model: string
      }
      const output = json.choices?.[0]?.message?.content ?? ''
      const promptTokens = json.usage?.prompt_tokens ?? 0
      const completionTokens = json.usage?.completion_tokens ?? 0
      const cost = calculateCost('openai', json.model ?? model, { promptTokens, completionTokens })?.totalCost ?? 0
      return { output, cost, latencyMs, tokens: promptTokens + completionTokens }
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
        model,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: content,
        messages: [{ role: 'user', content: userContent }],
      }),
    })
    const latencyMs = Date.now() - startMs
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { error: `Anthropic error (${res.status}): ${text.slice(0, 200)}` }
    }
    const json = await res.json() as {
      content: Array<{ type: string; text: string }>
      usage: { input_tokens: number; output_tokens: number }
      model: string
    }
    const output = json.content?.find((b) => b.type === 'text')?.text ?? ''
    const promptTokens = json.usage?.input_tokens ?? 0
    const completionTokens = json.usage?.output_tokens ?? 0
    const cost = calculateCost('anthropic', json.model ?? model, { promptTokens, completionTokens })?.totalCost ?? 0
    return { output, cost, latencyMs, tokens: promptTokens + completionTokens }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ── Judge (subset of eval-runner.callJudge — local copy to avoid coupling) ──

function buildJudgePrompt(criterion: string, responseText: string, scaleMin: number, scaleMax: number): string {
  const truncated = responseText.length > 4000
    ? responseText.slice(0, 4000) + '… [truncated]'
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

function parseJudgeReply(text: string, scaleMin: number, scaleMax: number): { score: number; reasoning: string } | null {
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

async function callJudge(
  config: JudgeConfig,
  responseText: string,
  apiKey: string,
): Promise<JudgeResult | null> {
  const prompt = buildJudgePrompt(config.criterion, responseText, config.scale_min, config.scale_max)
  if (config.judge_provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
    const range = config.scale_max - config.scale_min || 1
    return {
      score: (parsed.score - config.scale_min) / range,
      reasoning: parsed.reasoning,
      cost,
      tokens,
    }
  }
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

// ── Concurrency pool ────────────────────────────────────────────────────────

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

// ── Main entry point ───────────────────────────────────────────────────────

interface RunInput {
  experimentId: string
  organizationId: string
  versionAId: string
  versionBId: string
  datasetId: string
  evaluatorId: string | null
  runProvider: 'openai' | 'anthropic'
  runModel: string
}

export async function runExperiment(input: RunInput): Promise<void> {
  const { experimentId, organizationId, versionAId, versionBId, datasetId, evaluatorId, runProvider, runModel } = input

  await supabaseAdmin
    .from('experiments')
    .update({ status: 'running' })
    .eq('id', experimentId)

  try {
    // Load both prompt versions
    const { data: versions, error: vErr } = await supabaseAdmin
      .from('prompt_versions')
      .select('id, content')
      .in('id', [versionAId, versionBId])
      .eq('organization_id', organizationId)

    if (vErr || !versions || versions.length !== 2) {
      throw new Error('Prompt versions not found')
    }
    const versionA = versions.find((v) => v.id === versionAId) as PromptVersionRow
    const versionB = versions.find((v) => v.id === versionBId) as PromptVersionRow

    // Load dataset items
    const { data: items, error: iErr } = await supabaseAdmin
      .from('dataset_items')
      .select('id, input')
      .eq('dataset_id', datasetId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(200) // hard cap for safety

    if (iErr) throw new Error(`Dataset items fetch failed: ${iErr.message}`)
    if (!items || items.length === 0) throw new Error('Dataset has no items')

    // Load provider key for prompt runs
    const { data: runKey, error: rkErr } = await supabaseAdmin
      .from('provider_keys')
      .select('id, encrypted_key')
      .eq('organization_id', organizationId)
      .eq('provider', runProvider)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (rkErr || !runKey) throw new Error(`No active ${runProvider} provider key for prompt runs`)
    const runApiKey = await aes256Decrypt(runKey.encrypted_key as string)
    if (!runApiKey) throw new Error('Failed to decrypt provider key')

    // Optional: load evaluator config + judge key
    let evaluatorConfig: JudgeConfig | null = null
    let judgeApiKey: string | null = null
    if (evaluatorId) {
      const { data: ev } = await supabaseAdmin
        .from('evaluators')
        .select('config')
        .eq('id', evaluatorId)
        .eq('organization_id', organizationId)
        .maybeSingle()
      if (!ev) throw new Error('Evaluator not found')
      evaluatorConfig = ev.config as unknown as JudgeConfig

      if (evaluatorConfig.judge_provider === runProvider) {
        judgeApiKey = runApiKey
      } else {
        const { data: jk } = await supabaseAdmin
          .from('provider_keys')
          .select('encrypted_key')
          .eq('organization_id', organizationId)
          .eq('provider', evaluatorConfig.judge_provider)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle()
        if (!jk) throw new Error(`No active ${evaluatorConfig.judge_provider} provider key for judge`)
        judgeApiKey = await aes256Decrypt(jk.encrypted_key as string)
        if (!judgeApiKey) throw new Error('Failed to decrypt judge key')
      }
    }

    // Initialize total_items so UI can show progress.
    await supabaseAdmin
      .from('experiments')
      .update({ total_items: items.length })
      .eq('id', experimentId)

    // Process each item
    type ItemOutcome = {
      datasetItemId: string
      outputA: string | null
      outputB: string | null
      costA: number
      costB: number
      latencyA: number | null
      latencyB: number | null
      tokensA: number
      tokensB: number
      scoreA: number | null
      scoreB: number | null
      reasoningA: string | null
      reasoningB: string | null
      errorA: string | null
      errorB: string | null
    }

    const outcomes = await pool(items as DatasetItemRow[], ITEM_CONCURRENCY, async (item): Promise<ItemOutcome> => {
      // Run both arms in parallel
      const [aResult, bResult] = await Promise.all([
        runPrompt(versionA.content, item, runProvider, runModel, runApiKey),
        runPrompt(versionB.content, item, runProvider, runModel, runApiKey),
      ])

      const outcome: ItemOutcome = {
        datasetItemId: item.id,
        outputA: 'output' in aResult ? aResult.output : null,
        outputB: 'output' in bResult ? bResult.output : null,
        costA: 'cost' in aResult ? aResult.cost : 0,
        costB: 'cost' in bResult ? bResult.cost : 0,
        latencyA: 'latencyMs' in aResult ? aResult.latencyMs : null,
        latencyB: 'latencyMs' in bResult ? bResult.latencyMs : null,
        tokensA: 'tokens' in aResult ? aResult.tokens : 0,
        tokensB: 'tokens' in bResult ? bResult.tokens : 0,
        scoreA: null, scoreB: null,
        reasoningA: null, reasoningB: null,
        errorA: 'error' in aResult ? aResult.error : null,
        errorB: 'error' in bResult ? bResult.error : null,
      }

      // Optionally judge both outputs
      if (evaluatorConfig && judgeApiKey) {
        if (outcome.outputA) {
          const j = await callJudge(evaluatorConfig, outcome.outputA, judgeApiKey)
          if (j) {
            outcome.scoreA = j.score
            outcome.reasoningA = j.reasoning
            outcome.costA += j.cost
          }
        }
        if (outcome.outputB) {
          const j = await callJudge(evaluatorConfig, outcome.outputB, judgeApiKey)
          if (j) {
            outcome.scoreB = j.score
            outcome.reasoningB = j.reasoning
            outcome.costB += j.cost
          }
        }
      }

      return outcome
    })

    // Persist results
    const resultRows = outcomes.map((o) => ({
      organization_id: organizationId,
      experiment_id: experimentId,
      dataset_item_id: o.datasetItemId,
      output_a: o.outputA,
      output_b: o.outputB,
      cost_a_usd: o.costA,
      cost_b_usd: o.costB,
      latency_a_ms: o.latencyA,
      latency_b_ms: o.latencyB,
      tokens_a: o.tokensA,
      tokens_b: o.tokensB,
      score_a: o.scoreA,
      score_b: o.scoreB,
      reasoning_a: o.reasoningA,
      reasoning_b: o.reasoningB,
      error_a: o.errorA,
      error_b: o.errorB,
    }))

    const { error: insErr } = await supabaseAdmin
      .from('experiment_results')
      .insert(resultRows)
    if (insErr) throw new Error(`Result insert failed: ${insErr.message}`)

    // Compute aggregates
    const totalCost = outcomes.reduce((s, o) => s + o.costA + o.costB, 0)
    const scoresA = outcomes.map((o) => o.scoreA).filter((s): s is number => s != null)
    const scoresB = outcomes.map((o) => o.scoreB).filter((s): s is number => s != null)
    const avgA = scoresA.length > 0 ? scoresA.reduce((a, b) => a + b, 0) / scoresA.length : null
    const avgB = scoresB.length > 0 ? scoresB.reduce((a, b) => a + b, 0) / scoresB.length : null

    await supabaseAdmin
      .from('experiments')
      .update({
        status: 'completed',
        completed_items: outcomes.length,
        avg_score_a: avgA,
        avg_score_b: avgB,
        total_cost_usd: totalCost,
        completed_at: new Date().toISOString(),
      })
      .eq('id', experimentId)
  } catch (err) {
    await supabaseAdmin
      .from('experiments')
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        completed_at: new Date().toISOString(),
      })
      .eq('id', experimentId)
  }
}
