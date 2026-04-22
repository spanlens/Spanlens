/**
 * Pure substitute-matching rules for the model recommendation engine.
 * Separated from model-recommend.ts so tests can import without pulling
 * in `db.ts` (which requires Supabase env at load time).
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

/**
 * Curated mapping: (provider, model) → preferred cheaper substitute.
 *
 * Keys use the alias form (e.g. 'openai:gpt-4o'). OpenAI returns dated
 * variants (e.g. 'gpt-4o-2024-08-06') in response bodies — that's what
 * ends up in `requests.model`. `matchSubstitute()` does a longest-prefix
 * lookup so dated variants still resolve to the right rule.
 */
export const SUBSTITUTES: Record<string, Substitute> = {
  'openai:gpt-4o': {
    suggestedProvider: 'openai',
    suggestedModel: 'gpt-4o-mini',
    costRatio: 0.06,
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 150,
    reason: 'Short inputs/outputs suggest classification/extraction workload — gpt-4o-mini covers it at ~15x lower cost.',
  },
  'anthropic:claude-3-opus-20240229': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.04,
    maxAvgPromptTokens: 500,
    maxAvgCompletionTokens: 200,
    reason: 'Low token volume per call fits Haiku 4.5 envelope; >20x cheaper with sub-second latency.',
  },
  'anthropic:claude-3-5-sonnet-20241022': {
    suggestedProvider: 'anthropic',
    suggestedModel: 'claude-haiku-4.5',
    costRatio: 0.25,
    maxAvgPromptTokens: 800,
    maxAvgCompletionTokens: 250,
    reason: 'Sonnet is overkill for short-context classification; Haiku 4.5 is ~4x cheaper with comparable accuracy.',
  },
  'gemini:gemini-1.5-pro': {
    suggestedProvider: 'gemini',
    suggestedModel: 'gemini-1.5-flash',
    costRatio: 0.067,
    maxAvgPromptTokens: 1000,
    maxAvgCompletionTokens: 300,
    reason: 'Flash is ~15x cheaper on short requests and often within 5% accuracy on structured tasks.',
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
