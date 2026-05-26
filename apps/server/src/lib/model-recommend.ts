import { getClickhouse, toClickhouseTimestamp } from './clickhouse.js'
import { requestsScope } from './requests-query.js'
// Import from the cache module directly — `model-recommend-rules.ts` no
// longer re-exports `matchSubstitute` because doing so created a circular
// ESM import that esbuild flattens into a TDZ ReferenceError at module
// load time. See the note in `model-recommend-rules.ts`.
import { matchSubstitute } from './model-recommendations-cache.js'

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

/** Shape returned by the ClickHouse aggregates query (all numbers are strings in JSONEachRow) */
interface AggregateRow {
  provider: string
  model: string
  sample_count: string
  avg_prompt_tokens: string
  avg_completion_tokens: string
  total_cost_usd: string | null
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

  const windowStartDate      = new Date(Date.now() - hours * 3_600_000)
  const priorWindowEndDate   = windowStartDate
  const priorWindowStartDate = new Date(Date.now() - 2 * hours * 3_600_000)

  const windowStartTs      = toClickhouseTimestamp(windowStartDate)
  const priorWindowEndTs   = toClickhouseTimestamp(priorWindowEndDate)
  const priorWindowStartTs = toClickhouseTimestamp(priorWindowStartDate)

  // Recommendations need to look back up to 2× the window, so skip plan
  // retention — otherwise a free user doing 30d analysis would lose the prior
  // window (30–60 days ago). Organisation isolation is still enforced.
  const scope = await requestsScope(organizationId, { ignoreRetention: true })

  // ── Phase 1: current-window aggregates ───────────────────────────────────
  let data: AggregateRow[] = []
  try {
    const res = await getClickhouse().query({
      query: `
        SELECT
          provider,
          model,
          count()                AS sample_count,
          avg(prompt_tokens)     AS avg_prompt_tokens,
          avg(completion_tokens) AS avg_completion_tokens,
          sum(cost_usd)          AS total_cost_usd
        FROM requests
        WHERE ${scope.whereScope}
          AND created_at >= parseDateTime64BestEffort({windowStart:String})
          AND status_code IN (200, 201, 202, 204)
          AND model    != ''
          AND provider != ''
        GROUP BY provider, model
      `,
      query_params: { ...scope.scopeParams, windowStart: windowStartTs },
      format: 'JSONEachRow',
    })
    data = await res.json<AggregateRow>()
  } catch {
    return []
  }

  // ── Phase 2: build candidates (no minSavings filter yet) ─────────────────
  interface Candidate extends ModelRecommendation {
    _monthlyCurrentCost: number
  }

  const candidates: Candidate[] = []

  for (const row of data) {
    const provider            = row.provider
    const model               = row.model
    const sample_count        = Number(row.sample_count)
    const avg_prompt_tokens   = Number(row.avg_prompt_tokens)
    const avg_completion_tokens = Number(row.avg_completion_tokens)
    const total_cost_usd      = Number(row.total_cost_usd ?? 0)

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
      interface CostRow { total_cost_usd: string | null }
      const res = await getClickhouse().query({
        query: `
          SELECT sum(cost_usd) AS total_cost_usd
          FROM requests
          WHERE ${scope.whereScope}
            AND provider = {provider:String}
            AND (model = {model:String} OR startsWith(model, {modelPrefix:String}))
            AND created_at >= parseDateTime64BestEffort({windowStart:String})
            AND created_at <  parseDateTime64BestEffort({windowEnd:String})
            AND status_code IN (200, 201, 202, 204)
        `,
        query_params: {
          ...scope.scopeParams,
          provider,
          model,
          modelPrefix: model + '-',
          windowStart: priorWindowStartTs,
          windowEnd: priorWindowEndTs,
        },
        format: 'JSONEachRow',
      })
      const rows = await res.json<CostRow>()
      return Number(rows[0]?.total_cost_usd ?? 0)
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
