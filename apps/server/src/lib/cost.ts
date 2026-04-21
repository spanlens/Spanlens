export type Provider = 'openai' | 'anthropic' | 'gemini'

export interface Usage {
  promptTokens: number
  completionTokens: number
}

export interface CostResult {
  totalCost: number
  promptCost: number
  completionCost: number
}

// Prices in USD per 1M tokens (updated 2026-04)
const MODEL_PRICES: Record<string, { prompt: number; completion: number }> = {
  // OpenAI
  'gpt-4o': { prompt: 2.5, completion: 10 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gpt-4-turbo': { prompt: 10, completion: 30 },
  'gpt-4': { prompt: 30, completion: 60 },
  'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
  // Anthropic
  'claude-opus-4-7': { prompt: 15, completion: 75 },
  'claude-sonnet-4-6': { prompt: 3, completion: 15 },
  'claude-haiku-4-5-20251001': { prompt: 0.8, completion: 4 },
  'claude-3-5-sonnet-20241022': { prompt: 3, completion: 15 },
  'claude-3-5-haiku-20241022': { prompt: 0.8, completion: 4 },
  'claude-3-opus-20240229': { prompt: 15, completion: 75 },
  // Gemini
  'gemini-1.5-pro': { prompt: 1.25, completion: 5 },
  'gemini-1.5-flash': { prompt: 0.075, completion: 0.3 },
  'gemini-2.0-flash': { prompt: 0.1, completion: 0.4 },
}

/**
 * OpenAI는 종종 dated suffix를 포함해 모델명을 반환합니다 (예: gpt-4o-mini-2024-07-18).
 * 정확 매칭이 실패하면 등록된 키들 중 가장 긴 prefix를 찾아 fallback 매칭합니다.
 */
function lookupPrice(model: string): { prompt: number; completion: number } | null {
  const exact = MODEL_PRICES[model]
  if (exact) return exact

  let bestKey = ''
  for (const key of Object.keys(MODEL_PRICES)) {
    if (model.startsWith(key) && key.length > bestKey.length) {
      bestKey = key
    }
  }
  return bestKey ? MODEL_PRICES[bestKey] ?? null : null
}

export function calculateCost(
  _provider: Provider,
  model: string,
  usage: Usage,
): CostResult | null {
  const prices = lookupPrice(model)
  if (!prices) return null

  const promptCost = (usage.promptTokens / 1_000_000) * prices.prompt
  const completionCost = (usage.completionTokens / 1_000_000) * prices.completion

  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
  }
}
