import { pgQuery } from './postgres.js'
import { requestsScope } from './requests-query.js'
import { lookupPrice, type Provider } from './cost.js'

/**
 * Prompt-cache savings estimator.
 *
 * Providers bill cached input tokens (`cache_read_tokens`) at a discounted
 * rate compared to the regular input price. This module aggregates the
 * calendar-month cache-read volume per model and converts it
 * into an estimated USD amount the org did NOT pay thanks to prompt caching:
 *
 *   savings = Σ_model  cache_read_tokens × (input_price − cache_read_price) / 1M
 *
 * Prices come from the same synchronous cache `calculateCost()` uses
 * (lib/model-prices-cache.ts via `lookupPrice`) — exact match + boundary-aware
 * longest-prefix fallback, so dated variants like `gpt-4o-mini-2024-07-18`
 * resolve correctly. Models with no price row (or no discounted cache rate)
 * contribute zero savings but still count toward token/request totals.
 *
 * Retention note: the query goes through `requestsScope` WITHOUT
 * `ignoreRetention`, so the number is computed only over data the org's plan
 * can actually see. A Free org late in the month sees a partial-month
 * estimate rather than numbers derived from rows it has no access to.
 */

/** Shape returned by the aggregate (numerics arrive as strings — see gotcha #19). */
export interface CacheSavingsRow {
  /**
   * Required for pricing: model names are not unique across providers, so
   * `lookupPrice` needs the owning provider to pick the right row.
   */
  provider: string
  model: string
  /**
   * Aliased `cache_read_tokens_sum`, NOT `cache_read_tokens`. The name is
   * part of this module's contract: `computeCacheSavings` reads it and its
   * tests assert on it. History: the suffix started as a workaround for
   * ClickHouse, which raised ILLEGAL_AGGREGATION (code 184) when an aggregate
   * alias shadowed a column named in WHERE. Postgres has no such restriction,
   * so the alias is now only a readability choice.
   */
  cache_read_tokens_sum: string
  cache_hit_requests: string
}

export interface CacheSavingsTotals {
  /** Estimated USD not paid this month thanks to discounted cache reads. */
  savingsUsd: number
  /** Total cached input tokens this month (all models, priced or not). */
  cacheReadTokens: number
  /** Requests this month that had at least one cache hit. */
  cacheHitRequests: number
}

export interface CacheSavingsSummary extends CacheSavingsTotals {
  /** ISO timestamp of the UTC month boundary the window starts at. */
  monthStart: string
}

/** UTC calendar-month boundary — injectable `now` keeps the math testable. */
export function currentMonthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

/**
 * Pure computation over aggregate rows. Separated from the query so unit
 * tests can exercise the pricing math without a database.
 */
export function computeCacheSavings(rows: CacheSavingsRow[]): CacheSavingsTotals {
  let savingsUsd = 0
  let cacheReadTokens = 0
  let cacheHitRequests = 0

  for (const row of rows) {
    // count(*)/sum() come back as strings — coerce defensively.
    const tokens = Number(row.cache_read_tokens_sum ?? 0)
    const hits = Number(row.cache_hit_requests ?? 0)
    if (!Number.isFinite(tokens) || tokens <= 0) continue

    cacheReadTokens += tokens
    cacheHitRequests += Number.isFinite(hits) ? hits : 0

    const price = lookupPrice(row.provider as Provider, row.model)
    if (!price) continue // unknown model — no price data, no savings claim

    // No explicit cacheRead price means the provider bills cache reads at the
    // full input rate — the discount (and therefore the saving) is zero.
    const cacheReadPrice = price.cacheRead ?? price.prompt
    const discountPer1m = Math.max(0, price.prompt - cacheReadPrice)
    savingsUsd += (tokens / 1_000_000) * discountPer1m
  }

  return { savingsUsd, cacheReadTokens, cacheHitRequests }
}

/**
 * Month-to-date cache savings for one org. Tenant isolation + plan retention
 * enforced via `requestsScope`. Throws on database failure — callers decide
 * how to surface it (the API route maps it to INTERNAL_ERROR).
 */
export async function getCacheSavings(organizationId: string): Promise<CacheSavingsSummary> {
  const monthStartDate = currentMonthStartUtc()
  const scope = await requestsScope(organizationId)

  const rows = await pgQuery<CacheSavingsRow & Record<string, unknown>>({
    query: `
      SELECT
        provider,
        model,
        sum(cache_read_tokens) AS cache_read_tokens_sum,
        count(*)               AS cache_hit_requests
      FROM requests
      WHERE ${scope.whereScope}
        AND created_at >= {monthStart}::timestamptz
        AND status_code IN (200, 201, 202, 204)
        AND cache_read_tokens > 0
      GROUP BY provider, model
    `,
    params: {
      ...scope.scopeParams,
      monthStart: monthStartDate.toISOString(),
    },
  })

  return {
    ...computeCacheSavings(rows),
    monthStart: monthStartDate.toISOString(),
  }
}
