// ─────────────────────────────────────────────────────────────────────────────
// Model recommendation rule cache — DB-backed substitute rules with
// stale-while-revalidate (P3.3). Mirror of model-prices-cache.ts.
//
// WHY THIS DESIGN
// ----------------
// `matchSubstitute()` is called from `model-recommend.ts` for every bucket
// considered (one per provider × model surfaced in the savings dashboard).
// Making it async would force every caller into await and add a DB round-trip
// per row. Instead we keep `matchSubstitute()` sync, back the rule table
// with a module-level cache, and refresh in the background every 5 minutes.
//
//   • Cold start            → uses FALLBACK_RULES (hard-coded copy of the
//                              shipped SUBSTITUTES const) and triggers a
//                              background refresh.
//   • Subsequent calls      → freshest cached snapshot (DB or fallback).
//   • Stale (>5 min)        → returns stale + kicks off refresh
//                              (stale-while-revalidate).
//   • DB unreachable        → falls back to hard-coded, logs once per minute.
//
// Vercel serverless caveat: each function instance has its own module
// memory, so updates propagate within TTL per instance (~5 min, ≤2× worst
// case across the fleet). Rules change a few times a month at most so this
// is fine.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from './db.js'
import type { Substitute } from './model-recommend-rules.js'
import { SUBSTITUTES as FALLBACK_RULES, matchSubstituteIn } from './model-recommend-rules.js'

export { FALLBACK_RULES }

const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes
const ERROR_LOG_THROTTLE_MS = 60 * 1000

let cache: Record<string, Substitute> = { ...FALLBACK_RULES }
let lastRefreshedAt = 0
let refreshInFlight: Promise<void> | null = null
let lastErrorLoggedAt = 0

/** Build the canonical rule key `provider:model` from a row or pair of strings. */
export function ruleKey(provider: string, model: string): string {
  return `${provider}:${model}`
}

/**
 * Sync rule map for the matcher. Always returns a non-empty record (worst
 * case: FALLBACK_RULES). Triggers an async refresh if stale.
 *
 * Safe to call on every request — never throws, never awaits.
 */
export function getCachedRules(): Record<string, Substitute> {
  maybeTriggerRefresh()
  return cache
}

/**
 * Match a bucket key like 'openai:gpt-4o-mini-2024-07-18' against the
 * currently cached rule set. Sync wrapper used by model-recommend.ts —
 * the rule-matching logic itself is in model-recommend-rules.ts so this
 * file stays free of the matching algorithm.
 */
export function matchSubstitute(key: string): Substitute | null {
  return matchSubstituteIn(key, getCachedRules())
}

/**
 * Force a synchronous refresh. Used by:
 *   - Admin API after mutations (so the response reflects the new rule)
 *   - Tests
 */
export async function refreshRulesNow(): Promise<boolean> {
  try {
    await doRefresh()
    return true
  } catch (err) {
    logRefreshError(err)
    return false
  }
}

/** Test helper — production code never needs this. */
export function _resetCacheForTests(): void {
  cache = { ...FALLBACK_RULES }
  lastRefreshedAt = 0
  refreshInFlight = null
}

// ── Internals ─────────────────────────────────────────────────────────────────

function maybeTriggerRefresh(): void {
  // In tests we don't have a real Supabase — skip the network call so test
  // stderr stays clean. Direct callers (refreshRulesNow) still work, so
  // tests that want to exercise the refresh path can do so explicitly.
  if (process.env['VITEST']) return

  const now = Date.now()
  const stale = now - lastRefreshedAt > CACHE_TTL_MS

  if (!stale) return
  if (refreshInFlight) return

  refreshInFlight = doRefresh()
    .catch(logRefreshError)
    .finally(() => {
      refreshInFlight = null
    })
}

interface RuleRow {
  current_provider: string
  current_model: string
  suggested_provider: string
  suggested_model: string
  cost_ratio: string | number
  max_avg_prompt_tokens: number
  max_avg_completion_tokens: number
  reason: string
}

async function doRefresh(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('model_recommendations')
    .select(
      'current_provider, current_model, suggested_provider, suggested_model, ' +
      'cost_ratio, max_avg_prompt_tokens, max_avg_completion_tokens, reason',
    )

  if (error) throw new Error(`model_recommendations fetch failed: ${error.message}`)
  if (!data || data.length === 0) {
    // Empty table — keep fallback values, but mark refresh as done so we
    // don't hammer the DB. Operator action required (seed the table).
    lastRefreshedAt = Date.now()
    return
  }

  const next: Record<string, Substitute> = {}
  for (const row of data as unknown as RuleRow[]) {
    const key = ruleKey(row.current_provider, row.current_model)
    next[key] = {
      suggestedProvider: row.suggested_provider,
      suggestedModel: row.suggested_model,
      // Decimal columns come back as strings in JSONEachRow; coerce.
      costRatio: Number(row.cost_ratio),
      maxAvgPromptTokens: row.max_avg_prompt_tokens,
      maxAvgCompletionTokens: row.max_avg_completion_tokens,
      reason: row.reason,
    }
  }
  // Merge fallback under DB rows so a model present in FALLBACK_RULES but
  // missing from the DB still resolves — protects against an admin
  // accidentally deleting a row.
  cache = { ...FALLBACK_RULES, ...next }
  lastRefreshedAt = Date.now()
}

function logRefreshError(err: unknown): void {
  const now = Date.now()
  if (now - lastErrorLoggedAt < ERROR_LOG_THROTTLE_MS) return
  lastErrorLoggedAt = now
  console.warn('[model-recommendations-cache] refresh failed, using stale/fallback rules:', err)
}
