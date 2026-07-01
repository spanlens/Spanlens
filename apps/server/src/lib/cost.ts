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
import type { ServiceTier } from '../parsers/openai.js'

// 'azure' shares the OpenAI price table (Azure OpenAI exposes OpenAI models
// at OpenAI prices). The proxy in proxy/azure.ts calls calculateCost('openai', ...)
// directly, but the type is included here so type-safe call sites that pass
// `requests.provider` through don't have to special-case it.
export type Provider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'azure'
  | 'mistral'
  | 'openrouter'
  | 'groq'
  | 'deepseek'
  | 'xai'
  | 'cohere'

export interface Usage {
  /** Total input tokens INCLUDING any cached/cache-creation portion. */
  promptTokens: number
  completionTokens: number
  /** Subset of promptTokens that hit a prompt cache (charged at reduced rate). */
  cacheReadTokens?: number | undefined
  /** Subset of promptTokens that created a cache entry (charged at premium rate). */
  cacheWriteTokens?: number | undefined
  /**
   * Tier the provider actually served the request from (NOT the requested tier).
   * Extracted by parsers from response body — see parsers/openai.ts and
   * parsers/gemini.ts. When omitted, no tier adjustment is applied
   * (equivalent to Standard / `default`).
   * `| undefined` explicit because of exactOptionalPropertyTypes.
   */
  serviceTier?: ServiceTier | undefined
}

/**
 * Tier-to-multiplier table.
 *
 * Per-1M-token rates in model_prices are the **Standard** tier. These factors
 * convert to other tiers using the provider-published deltas:
 *
 *   default / auto / scale → 1.0× (Standard or auto-resolved-to-Standard)
 *   batch                  → 0.5× (50% discount; Batch API + Gemini Batch)
 *   flex                   → 0.5× (OpenAI: "Tokens are priced at Batch API rates")
 *   priority               → 1.8× (OpenAI: "+80% over Standard")
 *
 * Approximations on purpose — exact per-tier prices vary by model and would
 * need a separate table. The multiplier is correct to within a few percent
 * for the documented tier pricing as of 2026-05.
 */
const TIER_MULTIPLIERS: Record<ServiceTier, number> = {
  default: 1.0,
  standard: 1.0,  // Gemini + Anthropic report this name for the Standard tier
  auto: 1.0,
  scale: 1.0,
  batch: 0.5,
  flex: 0.5,
  priority: 1.8,
}

function tierMultiplier(tier: ServiceTier | undefined): number {
  if (!tier) return 1.0
  return TIER_MULTIPLIERS[tier] ?? 1.0
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

  // Tier selection — if longThreshold is set and the full prompt crossed it,
  // swap in the long_* prices for axes that have them. Axes left undefined
  // on the long tier fall through to the short-tier prices (e.g. gpt-5.5-pro
  // has long prompt/completion but no separate long cache_read price).
  //
  // We branch on usage.promptTokens (total input, cache included) rather than
  // nonCachedPromptTokens — OpenAI/Gemini both bill the long tier based on the
  // raw context size sent to the model, not on the non-cached subset.
  const inLongTier =
    prices.longThreshold != null && usage.promptTokens > prices.longThreshold
  const promptPrice     = inLongTier ? (prices.longPrompt     ?? prices.prompt)     : prices.prompt
  const completionPrice = inLongTier ? (prices.longCompletion ?? prices.completion) : prices.completion
  const cacheReadShort  = prices.cacheRead  ?? prices.prompt
  const cacheWriteShort = prices.cacheWrite ?? prices.prompt
  const cacheReadPrice  = inLongTier ? (prices.longCacheRead  ?? cacheReadShort)  : cacheReadShort
  const cacheWritePrice = inLongTier ? (prices.longCacheWrite ?? cacheWriteShort) : cacheWriteShort

  // Tier multiplier applies AFTER cache-aware breakdown. Provider tier
  // pricing is published as a flat factor over the Standard rate — Flex
  // discount and Priority premium scale all axes (prompt / completion /
  // cache) identically. See TIER_MULTIPLIERS comment.
  const tierMult = tierMultiplier(usage.serviceTier)

  const promptCost = (nonCachedPromptTokens / 1_000_000) * promptPrice * tierMult
  const cacheReadCost = (cacheRead / 1_000_000) * cacheReadPrice * tierMult
  const cacheWriteCost = (cacheWrite / 1_000_000) * cacheWritePrice * tierMult
  const completionCost = (usage.completionTokens / 1_000_000) * completionPrice * tierMult

  return {
    promptCost,
    completionCost,
    cacheReadCost,
    cacheWriteCost,
    totalCost: promptCost + completionCost + cacheReadCost + cacheWriteCost,
  }
}
