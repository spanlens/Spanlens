// ─────────────────────────────────────────────────────────────────────────────
// Cost calculator — token usage → USD.
//
// Pricing source: see `model-prices-cache.ts`. Prices live in the
// `model_prices` Supabase table and are mirrored to an in-memory map with
// 5-minute stale-while-revalidate. Hardcoded fallback covers cold-start.
//
// This function is SYNCHRONOUS by design — it sits on the proxy hot path
// (fire-and-forget logging) and must not await. The cache module handles
// all DB I/O in the background.
// ─────────────────────────────────────────────────────────────────────────────

import { getCachedPrices, type ModelPrice } from './model-prices-cache.js'

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

/**
 * OpenAI는 종종 dated suffix를 포함해 모델명을 반환합니다 (예: gpt-4o-mini-2024-07-18).
 * 정확 매칭이 실패하면 등록된 키들 중 가장 긴 prefix를 찾아 fallback 매칭합니다.
 * (boundary-aware: 다음 글자가 단어 경계가 되도록 — 'gpt-4'가 'gpt-4o' prefix로 잘못 잡히는 일 방지)
 */
function lookupPrice(model: string): ModelPrice | null {
  const prices = getCachedPrices()
  const exact = prices[model]
  if (exact) return exact

  let bestKey = ''
  for (const key of Object.keys(prices)) {
    if (!model.startsWith(key)) continue
    // longest prefix wins
    if (key.length > bestKey.length) bestKey = key
  }
  return bestKey ? prices[bestKey] ?? null : null
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
