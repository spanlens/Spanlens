/**
 * Pure substitute-matching rules for the model recommendation engine.
 * Separated from model-recommend.ts so tests can import without pulling
 * in `db.ts` (which requires Supabase env at load time).
 *
 * Key format: `provider:model-alias`
 *   - Use the canonical alias (no date suffix). matchSubstitute() handles
 *     dated variants (e.g. gpt-4o-2024-08-06) via longest-prefix lookup.
 *   - Anthropic keys use the exact string Anthropic returns in API response
 *     bodies (e.g. claude-3-5-sonnet-20241022 for the Sonnet 3.5 family).
 *
 * Cost ratios are computed from provider list prices at a typical blended
 * token mix (input-dominant). Update whenever providers reprice or release
 * new models. Rule: costRatio = suggestedModel_price / currentModel_price.
 *
 * ⚠️  IMPORTANT: only add a rule when the suggested model is CHEAPER.
 *   Counter-example: claude-3-5-haiku ($0.80/$4) → claude-haiku-4.5 ($1/$5)
 *   would be a 25% PRICE INCREASE — do NOT add such a rule.
 */

export interface Substitute {
  suggestedProvider: string
  suggestedModel: string
  /** Empirical multiplier applied to current cost to estimate cost of substitute */
  costRatio: number
  /** Max avg-prompt-tokens to suggest this substitute */
  maxAvgPromptTokens: number
  /** Max avg-completion-tokens */
  maxAvgCompletionTokens: number
  reason: string
}

export const SUBSTITUTES: Record<string, Substitute> = {
  // ── OpenAI ──────────────────────────────────────────────────────────
  'openai:gpt-4o': {
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o-mini',
    costRatio: 0.06,           // gpt-4o-mini is ~17x cheaper ($0.15 vs $2.50/1M input)
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 150,
    reason: 'Short inputs/outputs fit the gpt-4o-mini envelope — ~17x cheaper with comparable accuracy on classification, extraction, and short-form generation.',
  },
  'openai:gpt-4.1': {
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4.1-mini',
    costRatio: 0.2,            // gpt-4.1-mini is 5x cheaper ($0.40 vs $2.00/1M input)
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 150,
    reason: 'Short inputs fit the gpt-4.1-mini envelope — 5x cheaper with comparable accuracy on classification and short-form generation.',
  },
  'openai:gpt-4-turbo': {
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o',
    costRatio: 0.25,           // gpt-4o is ~4x cheaper ($2.50 vs $10.00/1M input)
    maxAvgPromptTokens: 2000,
    maxAvgCompletionTokens: 500,
    reason: 'gpt-4o delivers equivalent reasoning at ~4x lower cost than gpt-4-turbo for most workloads.',
  },
  'openai:gpt-4': {
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o',
    costRatio: 0.083,          // gpt-4o is ~12x cheaper ($2.50 vs $30.00/1M input)
    maxAvgPromptTokens: 4000,
    maxAvgCompletionTokens: 1000,
    reason: 'Legacy gpt-4 (8k) is ~12x more expensive than gpt-4o with no quality advantage on modern workloads.',
  },

  // ── Anthropic ────────────────────────────────────────────────────────
  // Keys use the exact string that Anthropic returns in API response bodies.
  // suggestedModel 'claude-haiku-4.5' matches both 'claude-haiku-4.5' and
  // 'claude-haiku-4-5-*' variants via cost.ts prefix lookup.

  'anthropic:claude-opus-4-7': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.2,            // Haiku 4.5 is 5x cheaper ($1 vs $5/1M input)
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 200,
    reason: 'Low token volume per call fits Haiku 4.5 — 5x cheaper with sub-second latency for short-context tasks.',
  },
  'anthropic:claude-3-opus-20240229': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.067,          // Haiku 4.5 is ~15x cheaper ($1 vs $15/1M input)
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 200,
    reason: 'Low token volume per call fits Haiku 4.5 — ~15x cheaper with sub-second latency for short-context tasks.',
  },
  'anthropic:claude-sonnet-4-6': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.333,          // Haiku 4.5 is ~3x cheaper ($1 vs $3/1M input)
    maxAvgPromptTokens: 800,
    maxAvgCompletionTokens: 250,
    reason: 'Sonnet 4.6 is overkill for short-context classification — Haiku 4.5 is ~3x cheaper with comparable accuracy at this token range.',
  },
  'anthropic:claude-sonnet-4-5': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.333,          // Haiku 4.5 is ~3x cheaper (same price family as Sonnet 4.x)
    maxAvgPromptTokens: 800,
    maxAvgCompletionTokens: 250,
    reason: 'Short-context workloads that fit Haiku 4.5\'s envelope are ~3x cheaper without measurable quality loss.',
  },
  'anthropic:claude-3-5-sonnet-20241022': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.333,          // Haiku 4.5 is ~3x cheaper ($1 vs $3/1M input)
    maxAvgPromptTokens: 800,
    maxAvgCompletionTokens: 250,
    reason: 'Sonnet 3.5 is overkill for short-context classification — Haiku 4.5 is ~3x cheaper with comparable accuracy at this token range.',
  },
  // NOTE: claude-3-5-haiku-20241022 → claude-haiku-4.5 rule intentionally omitted:
  // claude-haiku-4.5 ($1.00/$5.00) is 25% MORE expensive than claude-3-5-haiku ($0.80/$4.00).

  // ── Google Gemini ────────────────────────────────────────────────────
  'gemini:gemini-2.5-pro': {
    suggestedProvider: 'gemini',
    suggestedModel: 'gemini-2.5-flash',
    costRatio: 0.25,           // 2.5-flash is ~4x cheaper ($0.30 vs $1.25/1M input, standard tier)
    maxAvgPromptTokens: 1000,
    maxAvgCompletionTokens: 300,
    reason: 'Gemini 2.5 Flash is ~4x cheaper than 2.5 Pro on short requests with comparable accuracy on structured tasks.',
  },
  'gemini:gemini-1.5-pro': {
    suggestedProvider: 'gemini',
    suggestedModel: 'gemini-1.5-flash',
    costRatio: 0.06,           // 1.5-flash is ~17x cheaper ($0.075 vs $1.25/1M input)
    maxAvgPromptTokens: 1000,
    maxAvgCompletionTokens: 300,
    reason: 'Gemini 1.5 Flash is ~17x cheaper than Pro on short requests and typically within 5% accuracy on structured tasks.',
  },
  'gemini:gemini-2.0-pro': {
    suggestedProvider: 'gemini',
    suggestedModel: 'gemini-2.0-flash',
    costRatio: 0.1,
    maxAvgPromptTokens: 1000,
    maxAvgCompletionTokens: 300,
    reason: 'Gemini 2.0 Flash delivers similar output quality at ~10x lower cost for short-context tasks.',
  },
}

/**
 * Match a bucket key like 'openai:gpt-4o-mini-2024-07-18' against the active
 * substitute rules. The rules come from the DB-backed cache by default;
 * callers may pass a precomputed `rules` map for tests / batch contexts.
 *
 * P3.3: rules are sourced from the `model_recommendations` table via
 * `getCachedRules()` (stale-while-revalidate, 5-min TTL). The SUBSTITUTES
 * constant above is the cold-start fallback — keep in sync with the seed
 * at `supabase/seeds/model_recommendations.sql`.
 *
 * Order:
 *   1. Exact match.
 *   2. Longest boundary-aware prefix — the registered key must be followed
 *      by `-` in the input so that e.g. 'openai:gpt-4' does NOT match
 *      'openai:gpt-4o-mini-2024-07-18' (different family).
 *
 * Note: callers must separately guard against self-recommendations — a dated
 * variant of the SUGGESTED model (e.g. gpt-4o-mini-2024-07-18) can match the
 * gpt-4o rule and would otherwise suggest switching to gpt-4o-mini, which is
 * a no-op. See model-recommend.ts for the suggestedKey guard.
 *
 * The `rules` parameter is optional: when omitted we resolve from the
 * cache module via a dynamic import to avoid a circular static import
 * (cache imports SUBSTITUTES from this file as its FALLBACK).
 */
export function matchSubstituteIn(
  key: string,
  rules: Record<string, Substitute>,
): Substitute | null {
  const exact = rules[key]
  if (exact) return exact

  let bestKey = ''
  for (const k of Object.keys(rules)) {
    if (key.startsWith(k + '-') && k.length > bestKey.length) {
      bestKey = k
    }
  }
  return bestKey ? (rules[bestKey] ?? null) : null
}

/**
 * Production matcher — see `./model-recommendations-cache.ts`.
 *
 * NOTE: do not re-export `matchSubstitute` from here. Doing so creates a
 * circular ES-module import (rules.ts ↔ cache.ts) which esbuild bundles in
 * a way that puts `SUBSTITUTES` in the temporal dead zone when the cache
 * module evaluates its top-level `let cache = { ...FALLBACK_RULES }`. That
 * surfaces as a runtime `ReferenceError: Cannot access 'X' before
 * initialization` at module load time, taking the entire server down
 * (every endpoint 500s, not just the recommendation route). The local test
 * runner doesn't reproduce this because Vitest uses native ESM without
 * the same bundle flattening. Import `matchSubstitute` from
 * `./model-recommendations-cache.js` directly at the call site instead.
 *
 * Tests that want to exercise the rule MATCHING logic against a known
 * rule set should call `matchSubstituteIn(key, FALLBACK_RULES)` directly
 * — it's pure and free of any side effects.
 */
