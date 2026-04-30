/**
 * Pure substitute-matching rules for the model recommendation engine.
 * Separated from model-recommend.ts so tests can import without pulling
 * in `db.ts` (which requires Supabase env at load time).
 *
 * Key format: `provider:model-alias`
 *   - Use the canonical alias (no date suffix). matchSubstitute() handles
 *     dated variants (e.g. gpt-4o-2024-08-06) via longest-prefix lookup.
 *   - Anthropic keys use the alias form (claude-3-5-sonnet-20241022 IS the
 *     canonical key for the Sonnet 3.5 family — Anthropic doesn't append
 *     further date suffixes to API responses for that generation).
 *
 * Cost ratios are empirical (input+output blended at typical token mix).
 * Update whenever Anthropic/OpenAI/Google reprice or release new models.
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
    costRatio: 0.06,           // gpt-4o-mini is ~15x cheaper at typical token mix
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 150,
    reason: 'Short inputs/outputs fit the gpt-4o-mini envelope — ~15x cheaper with comparable accuracy on classification, extraction, and short-form generation.',
  },
  'openai:gpt-4-turbo': {
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o',
    costRatio: 0.5,            // gpt-4o is ~2x cheaper than gpt-4-turbo
    maxAvgPromptTokens: 2000,
    maxAvgCompletionTokens: 500,
    reason: 'gpt-4o delivers equivalent reasoning at roughly half the cost of gpt-4-turbo for most workloads.',
  },
  'openai:gpt-4': {
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o',
    costRatio: 0.17,           // gpt-4o is ~6x cheaper than legacy gpt-4 (8k)
    maxAvgPromptTokens: 4000,
    maxAvgCompletionTokens: 1000,
    reason: 'Legacy gpt-4 (8k) is significantly more expensive than gpt-4o with no quality advantage on modern workloads.',
  },

  // ── Anthropic ────────────────────────────────────────────────────────
  // Keys use the exact string that Anthropic returns in API response bodies.
  'anthropic:claude-3-opus-20240229': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.04,           // Haiku 4.5 is ~25x cheaper than Opus 3
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 200,
    reason: 'Low token volume per call fits Haiku 4.5 envelope — >20x cheaper with sub-second latency for short-context tasks.',
  },
  'anthropic:claude-3-5-sonnet-20241022': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.25,           // Haiku 4.5 is ~4x cheaper than Sonnet 3.5
    maxAvgPromptTokens: 800,
    maxAvgCompletionTokens: 250,
    reason: 'Sonnet 3.5 is overkill for short-context classification — Haiku 4.5 is ~4x cheaper with comparable accuracy at this token range.',
  },
  'anthropic:claude-3-5-haiku-20241022': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.5,            // claude-haiku-4.5 is ~2x cheaper than claude-3-5-haiku
    maxAvgPromptTokens: 1000,
    maxAvgCompletionTokens: 300,
    reason: 'claude-haiku-4.5 (2025) is faster and roughly half the price of claude-3-5-haiku with equivalent capability on structured tasks.',
  },
  'anthropic:claude-sonnet-4-5': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.2,
    maxAvgPromptTokens: 800,
    maxAvgCompletionTokens: 250,
    reason: 'Short-context workloads that fit Haiku 4.5\'s envelope are ~5x cheaper without measurable quality loss.',
  },

  // ── Google Gemini ────────────────────────────────────────────────────
  'gemini:gemini-1.5-pro': {
    suggestedProvider: 'gemini',
    suggestedModel: 'gemini-1.5-flash',
    costRatio: 0.067,          // Flash is ~15x cheaper than Pro
    maxAvgPromptTokens: 1000,
    maxAvgCompletionTokens: 300,
    reason: 'Gemini 1.5 Flash is ~15x cheaper than Pro on short requests and typically within 5% accuracy on structured tasks.',
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
 * Match a bucket key like 'openai:gpt-4o-mini-2024-07-18' against SUBSTITUTES.
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
 */
export function matchSubstitute(key: string): Substitute | null {
  const exact = SUBSTITUTES[key]
  if (exact) return exact

  let bestKey = ''
  for (const k of Object.keys(SUBSTITUTES)) {
    if (key.startsWith(k + '-') && k.length > bestKey.length) {
      bestKey = k
    }
  }
  return bestKey ? (SUBSTITUTES[bestKey] ?? null) : null
}
