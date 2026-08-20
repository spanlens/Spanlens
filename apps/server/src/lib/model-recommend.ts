import { pgQuery } from './postgres.js'
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
 * Aggregation is done in SQL rather than by pulling rows through PostgREST,
 * which would hit the 1000-row default select limit and silently truncate
 * data for high-traffic orgs, producing wrong recommendations.
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

/**
 * Shape returned by the aggregates query. `count(*)` is `int8` and every
 * `avg` / `sum` over a numeric column is `numeric`; the driver hands both back
 * as strings to avoid precision loss, so each field is coerced at the point of
 * use (postgres.ts documents the rule).
 */
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

  // Bound as ISO-8601 (trailing `Z` kept) and cast with `::timestamptz`, so
  // the comparison is UTC regardless of session timezone.
  const windowStartTs      = windowStartDate.toISOString()
  const priorWindowEndTs   = priorWindowEndDate.toISOString()
  const priorWindowStartTs = priorWindowStartDate.toISOString()

  // Recommendations need to look back up to 2× the window, so skip plan
  // retention — otherwise a free user doing 30d analysis would lose the prior
  // window (30–60 days ago). Organisation isolation is still enforced.
  const scope = await requestsScope(organizationId, { ignoreRetention: true })

  // ── Phase 1: current-window aggregates ───────────────────────────────────
  let data: AggregateRow[] = []
  try {
    data = await pgQuery<AggregateRow & Record<string, unknown>>({
      query: `
        SELECT
          provider,
          model,
          count(*)               AS sample_count,
          avg(prompt_tokens)     AS avg_prompt_tokens,
          avg(completion_tokens) AS avg_completion_tokens,
          sum(cost_usd)          AS total_cost_usd
        FROM requests
        WHERE ${scope.whereScope}
          AND created_at >= {windowStart}::timestamptz
          AND status_code IN (200, 201, 202, 204)
          AND model    != ''
          AND provider != ''
        GROUP BY provider, model
      `,
      params: { ...scope.scopeParams, windowStart: windowStartTs },
    })
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

  // ── Phase 3: prior-window cost (ONE grouped query) ───────────────────────
  //
  // Deliberately NOT one query per candidate inside a `Promise.all`. The pool
  // is sized 1 to 2 connections per instance, so those "parallel" queries
  // serialise on it and can exhaust it, starving every other request the
  // instance is serving.
  //
  // So: a single grouped scan over the prior window, narrowed to the
  // candidates' providers, with the boundary-aware model matching done in JS.
  // Matching per candidate, rather than assigning each row to one bucket, is
  // what keeps a dated variant such as `gpt-4o-mini-2024-07-18` counting
  // toward BOTH a `gpt-4o-mini` and a `gpt-4o` candidate.
  interface PriorCostRow {
    provider: string
    model: string
    total_cost_usd: string | null
  }

  /** Same rule the per-candidate query used: exact match, or `<model>-` prefix. */
  function matchesCandidateModel(rowModel: string, candidateModel: string): boolean {
    return rowModel === candidateModel || rowModel.startsWith(candidateModel + '-')
  }

  async function fetchPriorCosts(): Promise<number[]> {
    if (candidates.length === 0) return []

    const providers = [...new Set(candidates.map((c) => c.currentProvider))]

    let rows: PriorCostRow[]
    try {
      rows = await pgQuery<PriorCostRow & Record<string, unknown>>({
        query: `
          SELECT provider, model, sum(cost_usd) AS total_cost_usd
          FROM requests
          WHERE ${scope.whereScope}
            AND provider = ANY({providers}::text[])
            AND created_at >= {windowStart}::timestamptz
            AND created_at <  {windowEnd}::timestamptz
            AND status_code IN (200, 201, 202, 204)
          GROUP BY provider, model
        `,
        params: {
          ...scope.scopeParams,
          providers,
          windowStart: priorWindowStartTs,
          windowEnd: priorWindowEndTs,
        },
      })
    } catch {
      return candidates.map(() => 0) // fail open — no prior data is not a blocker
    }

    return candidates.map((c) => {
      let total = 0
      for (const row of rows) {
        if (row.provider !== c.currentProvider) continue
        if (!matchesCandidateModel(row.model, c.currentModel)) continue
        total += Number(row.total_cost_usd ?? 0)
      }
      return total
    })
  }

  const priorCosts = await fetchPriorCosts()

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

/** Token-count percentiles for one provider/model over a recent window. */
export interface TokenPercentiles {
  p50PromptTokens: number
  p95PromptTokens: number
  p99PromptTokens: number
  p50CompletionTokens: number
  p95CompletionTokens: number
  p99CompletionTokens: number
  sampleCount: number
}

interface PercentileRow {
  p50_prompt: string | number | null
  p95_prompt: string | number | null
  p99_prompt: string | number | null
  p50_completion: string | number | null
  p95_completion: string | number | null
  p99_completion: string | number | null
  sample_count: string | number
}

/**
 * Prompt and completion token percentiles for a provider/model pair, used by
 * `/api/v1/recommendations/percentiles` to show what a typical call to a model
 * actually costs before someone swaps to a cheaper one.
 *
 * Returns null when the window holds no usable sample, so the caller can show
 * "not enough data" rather than a row of zeroes.
 *
 * `starts_with(model, prefix)` widens the match to dated variants: OpenAI
 * reports `gpt-4o-mini-2024-07-18` in the response body, and that is what gets
 * stored, so an exact match on `gpt-4o-mini` alone would find nothing.
 *
 * `ignoreRetention` keeps the window the caller asked for rather than clipping
 * it to the plan's retention — this is a sizing calculation, not a data view.
 * Tenant isolation still comes from `requestsScope`.
 */
export async function getTokenPercentiles(
  organizationId: string,
  opts: { provider: string; model: string; hours: number },
): Promise<TokenPercentiles | null> {
  const windowStart = new Date(Date.now() - opts.hours * 3_600_000).toISOString()
  const scope = await requestsScope(organizationId, { ignoreRetention: true })

  const rows = await pgQuery<PercentileRow & Record<string, unknown>>({
    query: `
      SELECT
        percentile_cont(0.50) WITHIN GROUP (ORDER BY prompt_tokens)     AS p50_prompt,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY prompt_tokens)     AS p95_prompt,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY prompt_tokens)     AS p99_prompt,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY completion_tokens) AS p50_completion,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY completion_tokens) AS p95_completion,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY completion_tokens) AS p99_completion,
        count(*)                                                        AS sample_count
      FROM requests
      WHERE ${scope.whereScope}
        AND provider = {provider}
        AND (model = {model} OR starts_with(model, {modelPrefix}))
        AND created_at >= {windowStart}::timestamptz
        AND status_code IN (200, 201, 202, 204)
        AND prompt_tokens     > 0
        AND completion_tokens > 0
    `,
    params: {
      ...scope.scopeParams,
      provider: opts.provider,
      model: opts.model,
      modelPrefix: opts.model + '-',
      windowStart,
    },
  })

  const row = rows[0]
  const sampleCount = row ? Number(row.sample_count) : 0
  if (!row || sampleCount === 0) return null

  return {
    p50PromptTokens:     Math.round(Number(row.p50_prompt     ?? 0)),
    p95PromptTokens:     Math.round(Number(row.p95_prompt     ?? 0)),
    p99PromptTokens:     Math.round(Number(row.p99_prompt     ?? 0)),
    p50CompletionTokens: Math.round(Number(row.p50_completion ?? 0)),
    p95CompletionTokens: Math.round(Number(row.p95_completion ?? 0)),
    p99CompletionTokens: Math.round(Number(row.p99_completion ?? 0)),
    sampleCount,
  }
}
