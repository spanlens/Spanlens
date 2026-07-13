/**
 * Providers accepted as LLM judges for evaluators and eval-run cost
 * estimation. Deliberately narrower than the 10 providers the proxy
 * supports — expanding this list is a product decision, not a refactor.
 *
 * Single source of truth for the three validation sites in `api/evals.ts`
 * (evaluator create, evaluator update, estimate), which previously each
 * carried their own copy of this array and could drift apart.
 */
export const VALID_JUDGE_PROVIDERS = [
  'openai',
  'anthropic',
  'gemini',
  'azure',
  'mistral',
  'openrouter',
] as const

export type JudgeProvider = (typeof VALID_JUDGE_PROVIDERS)[number]

export function isValidJudgeProvider(value: string): value is JudgeProvider {
  return (VALID_JUDGE_PROVIDERS as readonly string[]).includes(value)
}
