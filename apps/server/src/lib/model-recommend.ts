import { supabaseAdmin } from './db.js'

/**
 * Heuristic model-recommendation engine.
 *
 * Idea: if a customer is using an expensive model (e.g. gpt-4o) for a
 * pattern of requests that stays well under some complexity threshold
 * (small inputs, small outputs, high volume), we suggest a cheaper
 * substitute with documented capability overlap.
 *
 * Substitutes are curated manually — we don't benchmark models at runtime.
 * Cost savings are computed from actual last-N-days spend per model.
 */

export interface ModelRecommendation {
  currentProvider: string
  currentModel: string
  sampleCount: number
  avgPromptTokens: number
  avgCompletionTokens: number
  totalCostUsdLastNDays: number
  suggestedProvider: string
  suggestedModel: string
  estimatedMonthlySavingsUsd: number
  reason: string
}

interface RequestRow {
  provider: string
  model: string
  cost_usd: number | null
  prompt_tokens: number | null
  completion_tokens: number | null
}

interface Substitute {
  suggestedProvider: string
  suggestedModel: string
  /** Empirical multiplier applied to current cost to estimate cost of substitute */
  costRatio: number
  /** Max avg-prompt-tokens to suggest this substitute (above → substitute may not fit) */
  maxAvgPromptTokens: number
  /** Max avg-completion-tokens */
  maxAvgCompletionTokens: number
  reason: string
}

/** Curated mapping: (provider, model) → preferred cheaper substitute */
const SUBSTITUTES: Record<string, Substitute> = {
  // OpenAI's gpt-4o family → gpt-4o-mini for simple classification/extraction
  'openai:gpt-4o': {
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o-mini',
    costRatio: 0.06, // ~94% cheaper per Tokens
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 150,
    reason: 'Short inputs/outputs suggest classification/extraction workload — gpt-4o-mini covers it at ~15x lower cost.',
  },
  // Anthropic Opus → Haiku for simple tasks
  'anthropic:claude-3-opus-20240229': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.04,
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 200,
    reason: 'Low token volume per call fits Haiku 4.5 envelope; >20x cheaper with sub-second latency.',
  },
  // Claude Sonnet (any rev) → Haiku for simple
  'anthropic:claude-3-5-sonnet-20241022': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.25,
    maxAvgPromptTokens: 800,
    maxAvgCompletionTokens: 250,
    reason: 'Sonnet is overkill for short-context classification; Haiku 4.5 is ~4x cheaper with comparable accuracy.',
  },
  // Gemini Pro → Flash
  'gemini:gemini-1.5-pro': {
    suggestedProvider: 'gemini',
    suggestedModel: 'gemini-1.5-flash',
    costRatio: 0.067,
    maxAvgPromptTokens: 1000,
    maxAvgCompletionTokens: 300,
    reason: 'Flash is ~15x cheaper on short requests and often within 5% accuracy on structured tasks.',
  },
}

export interface RecommendOptions {
  /** Analysis window in hours. Default 7 days. */
  hours?: number
  /** Minimum samples per (provider,model) to consider. Default 50. */
  minSamples?: number
  /** Only recommend if projected monthly savings ≥ this USD. Default $5. */
  minSavingsUsd?: number
}

export async function recommendModelSwaps(
  organizationId: string,
  opts: RecommendOptions = {},
): Promise<ModelRecommendation[]> {
  const hours = opts.hours ?? 24 * 7
  const minSamples = opts.minSamples ?? 50
  const minSavingsUsd = opts.minSavingsUsd ?? 5
  const windowStart = new Date(Date.now() - hours * 3_600_000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('requests')
    .select('provider, model, cost_usd, prompt_tokens, completion_tokens')
    .eq('organization_id', organizationId)
    .gte('created_at', windowStart)
    .in('status_code', [200, 201, 202, 204])
    .not('model', 'is', null)

  if (error || !data) return []

  const buckets = new Map<string, RequestRow[]>()
  for (const r of data as RequestRow[]) {
    const key = `${r.provider}:${r.model}`
    const list = buckets.get(key) ?? []
    list.push(r)
    buckets.set(key, list)
  }

  const recommendations: ModelRecommendation[] = []

  for (const [key, rows] of buckets) {
    if (rows.length < minSamples) continue
    const sub = SUBSTITUTES[key]
    if (!sub) continue

    const [provider = '', model = ''] = key.split(':')
    const avgPrompt = avg(rows.map((r) => r.prompt_tokens))
    const avgCompletion = avg(rows.map((r) => r.completion_tokens))
    const totalCost = rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0)

    // Fit check
    if (avgPrompt > sub.maxAvgPromptTokens) continue
    if (avgCompletion > sub.maxAvgCompletionTokens) continue

    // Extrapolate current window cost to a month, compute projected savings
    const monthFactor = (24 * 30) / hours
    const monthlyCurrentCost = totalCost * monthFactor
    const monthlyProjectedCost = monthlyCurrentCost * sub.costRatio
    const monthlySavings = monthlyCurrentCost - monthlyProjectedCost

    if (monthlySavings < minSavingsUsd) continue

    recommendations.push({
      currentProvider: provider,
      currentModel: model,
      sampleCount: rows.length,
      avgPromptTokens: avgPrompt,
      avgCompletionTokens: avgCompletion,
      totalCostUsdLastNDays: totalCost,
      suggestedProvider: sub.suggestedProvider,
      suggestedModel: sub.suggestedModel,
      estimatedMonthlySavingsUsd: monthlySavings,
      reason: sub.reason,
    })
  }

  recommendations.sort(
    (a, b) => b.estimatedMonthlySavingsUsd - a.estimatedMonthlySavingsUsd,
  )
  return recommendations
}

function avg(values: readonly (number | null)[]): number {
  const finite = values.filter((v): v is number => typeof v === 'number')
  if (finite.length === 0) return 0
  return finite.reduce((s, v) => s + v, 0) / finite.length
}
