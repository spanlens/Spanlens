export type Provider = 'openai' | 'anthropic' | 'gemini'

export interface Usage {
  /** Total input tokens INCLUDING any cached/cache-creation portion. */
  promptTokens: number
  completionTokens: number
  /** Subset of promptTokens that hit a prompt cache (charged at reduced rate). */
  cacheReadTokens?: number
  /** Subset of promptTokens that created a cache entry (charged at premium rate). */
  cacheWriteTokens?: number
}

export interface CostResult {
  totalCost: number
  /** Cost of non-cached prompt tokens (regular input). */
  promptCost: number
  completionCost: number
  /** Cost of cached input tokens (0 if no cache hit). */
  cacheReadCost: number
  /** Cost of cache-creation tokens (0 if not applicable). */
  cacheWriteCost: number
}

interface ModelPrice {
  prompt: number
  completion: number
  /** USD per 1M cached input tokens. If undefined, cache_read is billed at `prompt` rate. */
  cacheRead?: number
  /** USD per 1M cache-creation tokens. If undefined, cache_write is billed at `prompt` rate. */
  cacheWrite?: number
}

// Prices in USD per 1M tokens (verified against provider pricing pages 2026-05).
// Cache rates:
//   • Anthropic — cache_read = 0.1 × input, cache_write (5min) = 1.25 × input
//   • OpenAI    — cached input ≈ 0.5 × input (gpt-4o / gpt-4.1 families)
const MODEL_PRICES: Record<string, ModelPrice> = {
  // ── OpenAI ────────────────────────────────────────────────────────────────
  'gpt-4o':        { prompt: 2.5,  completion: 10,  cacheRead: 1.25 },
  'gpt-4o-mini':   { prompt: 0.15, completion: 0.6, cacheRead: 0.075 },
  'gpt-4.1':       { prompt: 2.0,  completion: 8.0, cacheRead: 0.5 },
  'gpt-4.1-mini':  { prompt: 0.4,  completion: 1.6, cacheRead: 0.1 },
  'gpt-4.1-nano':  { prompt: 0.1,  completion: 0.4, cacheRead: 0.025 },
  'gpt-4-turbo':   { prompt: 10,   completion: 30 },
  'gpt-4':         { prompt: 30,   completion: 60 },
  'gpt-3.5-turbo': { prompt: 0.5,  completion: 1.5 },
  // ── Anthropic ────────────────────────────────────────────────────────────
  'claude-opus-4-7':            { prompt: 5,    completion: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-sonnet-4-6':          { prompt: 3,    completion: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  // claude-haiku-4-5 — all aliases (dot notation API alias, dash API response body, dated)
  'claude-haiku-4.5':           { prompt: 1,    completion: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  'claude-haiku-4-5':           { prompt: 1,    completion: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  'claude-haiku-4-5-20251001':  { prompt: 1,    completion: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  'claude-3-5-sonnet-20241022': { prompt: 3,    completion: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-3-5-haiku-20241022':  { prompt: 0.8,  completion: 4,  cacheRead: 0.08, cacheWrite: 1.0 },
  'claude-3-opus-20240229':     { prompt: 15,   completion: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  // ── Gemini (caching not yet exposed in our integration) ──────────────────
  'gemini-2.5-pro':        { prompt: 1.25,  completion: 10 },
  'gemini-2.5-flash':      { prompt: 0.3,   completion: 2.5 },
  'gemini-2.5-flash-lite': { prompt: 0.1,   completion: 0.4 },
  'gemini-2.0-flash':      { prompt: 0.1,   completion: 0.4 }, // deprecated 2026-06-01, kept for historical data
  'gemini-1.5-pro':        { prompt: 1.25,  completion: 5 },
  'gemini-1.5-flash':      { prompt: 0.075, completion: 0.3 },
}

/**
 * OpenAI는 종종 dated suffix를 포함해 모델명을 반환합니다 (예: gpt-4o-mini-2024-07-18).
 * 정확 매칭이 실패하면 등록된 키들 중 가장 긴 prefix를 찾아 fallback 매칭합니다.
 * (boundary-aware: 다음 글자가 단어 경계가 되도록 — 'gpt-4'가 'gpt-4o' prefix로 잘못 잡히는 일 방지)
 */
function lookupPrice(model: string): ModelPrice | null {
  const exact = MODEL_PRICES[model]
  if (exact) return exact

  let bestKey = ''
  for (const key of Object.keys(MODEL_PRICES)) {
    if (!model.startsWith(key)) continue
    // longest prefix wins
    if (key.length > bestKey.length) bestKey = key
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

  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  // promptTokens is "total input INCLUDING cache". Subtract the cache portions
  // to get the non-cached input charged at the regular prompt rate. Clamped at 0
  // in case of unexpected reporter inconsistencies.
  const nonCachedPromptTokens = Math.max(0, usage.promptTokens - cacheRead - cacheWrite)

  // Models without explicit cache pricing fall back to the regular prompt rate
  // (matches the historical behavior — no surprise cost reduction for models
  // that lack a published cache price).
  const cacheReadPrice = prices.cacheRead ?? prices.prompt
  const cacheWritePrice = prices.cacheWrite ?? prices.prompt

  const promptCost = (nonCachedPromptTokens / 1_000_000) * prices.prompt
  const cacheReadCost = (cacheRead / 1_000_000) * cacheReadPrice
  const cacheWriteCost = (cacheWrite / 1_000_000) * cacheWritePrice
  const completionCost = (usage.completionTokens / 1_000_000) * prices.completion

  return {
    promptCost,
    completionCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: promptCost + completionCost + cacheReadCost + cacheWriteCost,
  }
}
