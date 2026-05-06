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
 *
 * Achieved tracking: each recommendation is enriched with prior-window
 * cost data (the equal-length window immediately before the current one).
 * A ≥70% drop in spend signals the org has adopted the swap, showing
 * realized savings alongside projected ones.
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
  /** Token envelope from the substitute rule — used by the Simulate dialog. */
  maxPromptTokens: number
  maxCompletionTokens: number
  /** Cost in the prior equal-length window. null = no prior data. */
  priorWindowCostUsd: number | null
  /** True if spend on this model dropped ≥70% vs the prior window. */
  achieved: boolean
  /** Realized monthly savings when achieved. null when not achieved. */
  actualMonthlySavingsUsd: number | null
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

/** A spend drop ≥ this fraction is treated as "model swap adopted". */
const ACHIEVED_DROP_THRESHOLD = 0.7

export async function recommendModelSwaps(
  organizationId: string,
  opts: RecommendOptions = {},
): Promise<ModelRecommendation[]> {
  const hours = opts.hours ?? 24 * 7
  const minSamples = opts.minSamples ?? 30
  const minSavingsUsd = opts.minSavingsUsd ?? 5
  const monthFactor = (24 * 30) / hours

  const windowStart = new Date(Date.now() - hours * 3_600_000).toISOString()
  const priorWindowEnd = windowStart
  const priorWindowStart = new Date(Date.now() - 2 * hours * 3_600_000).toISOString()

  // ── Phase 1: current-window aggregates ───────────────────────────────────
  const { data, error } = await supabaseAdmin.rpc('get_model_aggregates', {
    p_organization_id: organizationId,
    p_window_start: windowStart,
    p_status_codes: [200, 201, 202, 204],
  })

  if (error || !data) return []

  // ── Phase 2: build candidates (no minSavings filter yet) ─────────────────
  interface Candidate extends ModelRecommendation {
    _monthlyCurrentCost: number
  }

  const candidates: Candidate[] = []

  for (const row of data as AggregateRow[]) {
    const { provider, model, sample_count, avg_prompt_tokens, avg_completion_tokens, total_cost_usd } = row

    if (sample_count < minSamples) continue

    const key = `${provider}:${model}`
    const sub = matchSubstitute(key)
    if (!sub) continue

    // Self-recommendation guard: skip if the org is already on the suggested model family.
    const suggestedKey = `${sub.suggestedProvider}:${sub.suggestedModel}`
    if (key === suggestedKey || key.startsWith(suggestedKey + '-')) continue

    // Token envelope check
    if (avg_prompt_tokens > sub.maxAvgPromptTokens) continue
    if (avg_completion_tokens > sub.maxAvgCompletionTokens) continue

    const monthlyCurrentCost = total_cost_usd * monthFactor
    const monthlyProjectedCost = monthlyCurrentCost * sub.costRatio
    const estimatedMonthlySavingsUsd = monthlyCurrentCost - monthlyProjectedCost

    candidates.push({
      currentProvider: provider,
      currentModel: model,
      sampleCount: sample_count,
      avgPromptTokens: avg_prompt_tokens,
      avgCompletionTokens: avg_completion_tokens,
      totalCostUsdLastNDays: total_cost_usd,
      suggestedProvider: sub.suggestedProvider,
      suggestedModel: sub.suggestedModel,
      estimatedMonthlySavingsUsd,
      reason: sub.reason,
      maxPromptTokens: sub.maxAvgPromptTokens,
      maxCompletionTokens: sub.maxAvgCompletionTokens,
      // enriched in Phase 3
      priorWindowCostUsd: null,
      achieved: false,
      actualMonthlySavingsUsd: null,
      _monthlyCurrentCost: monthlyCurrentCost,
    })
  }

  // ── Phase 3: prior-window cost (parallel) ────────────────────────────────
  async function fetchPriorCost(provider: string, model: string): Promise<number> {
    try {
      const r = await supabaseAdmin.rpc('get_model_prior_window_cost', {
        p_organization_id: organizationId,
        p_provider: provider,
        p_model: model,
        p_window_start: priorWindowStart,
        p_window_end: priorWindowEnd,
      })
      return typeof r.data === 'number' ? r.data : 0
    } catch {
      return 0 // fail open — no prior data is not a blocker
    }
  }

  const priorCosts = await Promise.all(
    candidates.map((c) => fetchPriorCost(c.currentProvider, c.currentModel)),
  )

  // ── Phase 4: enrich + filter ──────────────────────────────────────────────
  const recommendations: ModelRecommendation[] = []

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    if (!c) continue  // TypeScript undefined guard

    const priorCost = priorCosts[i] ?? 0

    const dropPct = priorCost > 0
      ? (priorCost - c.totalCostUsdLastNDays) / priorCost
      : null

    const achieved = dropPct !== null && dropPct >= ACHIEVED_DROP_THRESHOLD
    const actualMonthlySavingsUsd = achieved
      ? (priorCost - c.totalCostUsdLastNDays) * monthFactor
      : null

    // Open recommendations: must clear minSavings threshold.
    if (!achieved && c.estimatedMonthlySavingsUsd < minSavingsUsd) continue

    // Achieved recommendations: only show if the prior window was meaningful
    // (avoids surfacing "achieved" for trivially small spend).
    if (achieved && priorCost * monthFactor < minSavingsUsd) continue

    const { _monthlyCurrentCost, ...rest } = c  // strip internal field
    void _monthlyCurrentCost
    recommendations.push({
      ...rest,
      priorWindowCostUsd: priorCost > 0 ? priorCost : null,
      achieved,
      actualMonthlySavingsUsd,
    })
  }

  // Sort: open items first (by estimated savings desc), then achieved (by actual savings desc)
  recommendations.sort((a, b) => {
    if (a.achieved !== b.achieved) return a.achieved ? 1 : -1
    const aVal = a.achieved ? (a.actualMonthlySavingsUsd ?? 0) : a.estimatedMonthlySavingsUsd
    const bVal = b.achieved ? (b.actualMonthlySavingsUsd ?? 0) : b.estimatedMonthlySavingsUsd
    return bVal - aVal
  })

  return recommendations
}
