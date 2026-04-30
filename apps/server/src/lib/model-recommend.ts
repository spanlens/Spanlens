import { supabaseAdmin } from './db.js'
import { matchSubstitute } from './model-recommend-rules.js'

/**
 * Heuristic model-recommendation engine.
 *
 * Idea: if a customer is using an expensive model (e.g. gpt-4o) for a
 * pattern of requests that stays well under some complexity threshold
 * (small inputs, small outputs, high volume), we suggest a cheaper
 * substitute with documented capability overlap.
 *
 * Substitutes (curated) + matching logic live in ./model-recommend-rules.ts
 * so unit tests can exercise them without pulling in the Supabase client.
 *
 * Aggregation is done in SQL via `get_model_aggregates()` RPC to avoid
 * Supabase's 1000-row default select limit — which would silently truncate
 * data for high-traffic orgs and produce wrong recommendations.
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

/** Shape returned by the get_model_aggregates() Postgres function */
interface AggregateRow {
  provider: string
  model: string
  sample_count: number
  avg_prompt_tokens: number
  avg_completion_tokens: number
  total_cost_usd: number
}

export interface RecommendOptions {
  /** Analysis window in hours. Default 7 days. */
  hours?: number
  /**
   * Minimum samples per (provider,model) to consider. Default 30.
   * Aligns with the "medium" confidence threshold shown in the UI
   * (≥$10/mo + ≥30 samples → medium; ≥$50/mo + ≥100 samples → high).
   */
  minSamples?: number
  /** Only recommend if projected monthly savings ≥ this USD. Default $5. */
  minSavingsUsd?: number
}

export async function recommendModelSwaps(
  organizationId: string,
  opts: RecommendOptions = {},
): Promise<ModelRecommendation[]> {
  const hours = opts.hours ?? 24 * 7
  const minSamples = opts.minSamples ?? 30   // was 50 — aligned to medium-confidence threshold
  const minSavingsUsd = opts.minSavingsUsd ?? 5
  const windowStart = new Date(Date.now() - hours * 3_600_000).toISOString()

  // SQL GROUP BY via RPC — avoids the Supabase 1000-row select limit and
  // is orders of magnitude faster than fetching raw rows into JS memory.
  const { data, error } = await supabaseAdmin.rpc('get_model_aggregates', {
    p_organization_id: organizationId,
    p_window_start: windowStart,
    p_status_codes: [200, 201, 202, 204],
  })

  if (error || !data) return []

  const recommendations: ModelRecommendation[] = []

  for (const row of data as AggregateRow[]) {
    const { provider, model, sample_count, avg_prompt_tokens, avg_completion_tokens, total_cost_usd } = row

    if (sample_count < minSamples) continue

    const key = `${provider}:${model}`
    const sub = matchSubstitute(key)
    if (!sub) continue

    // Bug fix: skip self-recommendation.
    // e.g. `openai:gpt-4o-mini-2024-07-18` matches the `openai:gpt-4o` rule
    // via longest-prefix and would suggest switching TO gpt-4o-mini — but the
    // org is ALREADY on gpt-4o-mini. The dated variant is the same family.
    const suggestedKey = `${sub.suggestedProvider}:${sub.suggestedModel}`
    if (key === suggestedKey || key.startsWith(suggestedKey + '-')) continue

    // Token envelope fit check
    if (avg_prompt_tokens > sub.maxAvgPromptTokens) continue
    if (avg_completion_tokens > sub.maxAvgCompletionTokens) continue

    // Extrapolate window cost → monthly, then compute projected savings
    const monthFactor = (24 * 30) / hours
    const monthlyCurrentCost = total_cost_usd * monthFactor
    const monthlyProjectedCost = monthlyCurrentCost * sub.costRatio
    const monthlySavings = monthlyCurrentCost - monthlyProjectedCost

    if (monthlySavings < minSavingsUsd) continue

    recommendations.push({
      currentProvider: provider,
      currentModel: model,
      sampleCount: sample_count,
      avgPromptTokens: avg_prompt_tokens,
      avgCompletionTokens: avg_completion_tokens,
      totalCostUsdLastNDays: total_cost_usd,
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
