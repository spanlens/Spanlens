// ─────────────────────────────────────────────────────────────────────────────
// Model price cache — DB-backed prices with stale-while-revalidate.
//
// WHY THIS DESIGN
// ----------------
// `calculateCost()` is sync and called on the hot path of every proxy request
// (often inside fire-and-forget log writes). Making it async would force every
// caller — 13 files at the time of writing — to thread `await` through their
// already-async chains, AND would add a Supabase round-trip to the critical
// path of logging. Neither is acceptable.
//
// Instead: keep `calculateCost()` sync, but back the price table with a
// module-level in-memory cache that refreshes from Supabase in the background.
//
//   • Cold start            → uses hardcoded FALLBACK_PRICES (always present)
//                              and triggers refresh in background.
//   • Subsequent calls      → use the freshest cached snapshot (DB or fallback).
//   • Stale (>5 min)        → returns stale data immediately AND kicks off
//                              a refresh (stale-while-revalidate).
//   • DB unreachable        → falls back to hardcoded, logs once per minute.
//
// Vercel serverless caveat: each function instance has its own module memory,
// so price updates propagate within `CACHE_TTL_MS` per instance. Across the
// fleet, expect ≤2× TTL worst-case (5–10 min) for full propagation. This is
// acceptable for prices that change quarterly at most.
//
// IMPORTANT: never await on this module from the proxy hot path. The whole
// point is that `getCachedPrices()` is synchronous and returns immediately.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from './db.js'

export interface ModelPrice {
  prompt: number
  completion: number
  /** USD per 1M cached input tokens. If undefined, cache_read is billed at `prompt` rate. */
  cacheRead?: number
  /** USD per 1M cache-creation tokens. If undefined, cache_write is billed at `prompt` rate. */
  cacheWrite?: number
  /**
   * Long-context tier overrides. When `longThreshold` is set and the request's
   * `promptTokens > longThreshold`, calculateCost() swaps in the long* prices
   * for whichever axes are defined (axes left undefined fall back to the
   * short-tier values on the same row).
   *
   *   OpenAI GPT-5.x  → longThreshold = 272000 tokens
   *   Gemini Pro 2.5+ → longThreshold = 200000 tokens
   */
  longThreshold?: number
  longPrompt?: number
  longCompletion?: number
  longCacheRead?: number
  longCacheWrite?: number
}

// Prices in USD per 1M tokens (verified against provider pricing pages 2026-05-22).
// This map is the COLD-START FALLBACK — used when the DB cache is empty
// (first request after deploy / DB unreachable). The DB is the source of truth
// once loaded; this constant exists to guarantee `calculateCost()` always has
// a valid map to read.
//
// Cache rates:
//   • Anthropic — cache_read = 0.1 × input, cache_write (5min) = 1.25 × input
//   • OpenAI    — cached input ≈ 0.5 × input (gpt-4o / gpt-4.1 families; explicit per-model in GPT-5.x)
//   • Gemini    — caching priced but our integration doesn't surface it yet
//   • Tiered Gemini models use the ≤200k token band
export const FALLBACK_PRICES: Record<string, ModelPrice> = {
  // ── OpenAI: GPT-5.x flagship ─────────────────────────────────────────────
  // gpt-5.5 / 5.5-pro / 5.4 / 5.4-pro have a long-context tier at ≥272k tokens.
  'gpt-5.5':           { prompt: 5.0,  completion: 30,  cacheRead: 0.5,
                         longThreshold: 272000, longPrompt: 10, longCompletion: 45, longCacheRead: 1.0 },
  'gpt-5.5-pro':       { prompt: 30,   completion: 180,
                         longThreshold: 272000, longPrompt: 60, longCompletion: 270 },
  'gpt-5.4':           { prompt: 2.5,  completion: 15,  cacheRead: 0.25,
                         longThreshold: 272000, longPrompt: 5, longCompletion: 22.5, longCacheRead: 0.5 },
  'gpt-5.4-mini':      { prompt: 0.75, completion: 4.5, cacheRead: 0.075 },
  'gpt-5.4-nano':      { prompt: 0.2,  completion: 1.25,cacheRead: 0.02 },
  'gpt-5.4-pro':       { prompt: 30,   completion: 180,
                         longThreshold: 272000, longPrompt: 60, longCompletion: 270 },
  'gpt-5.3-codex':     { prompt: 1.75, completion: 14,  cacheRead: 0.175 },
  // ── OpenAI: GPT-5 base family (single tier) ──────────────────────────────
  'gpt-5':         { prompt: 1.25, completion: 10,   cacheRead: 0.125 },
  'gpt-5.1':       { prompt: 1.25, completion: 10,   cacheRead: 0.125 },
  'gpt-5.2':       { prompt: 1.75, completion: 14,   cacheRead: 0.175 },
  'gpt-5.2-pro':   { prompt: 21,   completion: 168 },
  'gpt-5-mini':    { prompt: 0.25, completion: 2.0,  cacheRead: 0.025 },
  'gpt-5-nano':    { prompt: 0.05, completion: 0.4,  cacheRead: 0.005 },
  'gpt-5-pro':     { prompt: 15,   completion: 120 },
  'chat-latest':   { prompt: 5,    completion: 30,   cacheRead: 0.5 },
  // ── OpenAI: Reasoning (o-series) ─────────────────────────────────────────
  'o4-mini':       { prompt: 1.10, completion: 4.4,  cacheRead: 0.275 },
  'o3':            { prompt: 2.0,  completion: 8.0,  cacheRead: 0.5 },
  'o3-mini':       { prompt: 1.10, completion: 4.4,  cacheRead: 0.55 },
  'o3-pro':        { prompt: 20,   completion: 80 },
  'o1':            { prompt: 15,   completion: 60,   cacheRead: 7.5 },
  'o1-mini':       { prompt: 1.10, completion: 4.4,  cacheRead: 0.55 },
  'o1-pro':        { prompt: 150,  completion: 600 },
  // ── OpenAI: GPT-4.x ──────────────────────────────────────────────────────
  'gpt-4o':                       { prompt: 2.5,  completion: 10,  cacheRead: 1.25 },
  'gpt-4o-mini':                  { prompt: 0.15, completion: 0.6, cacheRead: 0.075 },
  'gpt-4o-2024-05-13':            { prompt: 5,    completion: 15 },
  'gpt-4.1':                      { prompt: 2.0,  completion: 8.0, cacheRead: 0.5 },
  'gpt-4.1-mini':                 { prompt: 0.4,  completion: 1.6, cacheRead: 0.1 },
  'gpt-4.1-nano':                 { prompt: 0.1,  completion: 0.4, cacheRead: 0.025 },
  'gpt-4-turbo':                  { prompt: 10,   completion: 30 },
  'gpt-4-turbo-2024-04-09':       { prompt: 10,   completion: 30 },
  'gpt-4-0125-preview':           { prompt: 10,   completion: 30 },
  'gpt-4-1106-preview':           { prompt: 10,   completion: 30 },
  'gpt-4-1106-vision-preview':    { prompt: 10,   completion: 30 },
  'gpt-4':                        { prompt: 30,   completion: 60 },
  'gpt-4-0613':                   { prompt: 30,   completion: 60 },
  'gpt-4-0314':                   { prompt: 30,   completion: 60 },
  'gpt-4-32k':                    { prompt: 60,   completion: 120 },
  // ── OpenAI: GPT-3.5 + base models ────────────────────────────────────────
  'gpt-3.5-turbo':                { prompt: 0.5,  completion: 1.5 },
  'gpt-3.5-turbo-0125':           { prompt: 0.5,  completion: 1.5 },
  'gpt-3.5-turbo-1106':           { prompt: 1.0,  completion: 2.0 },
  'gpt-3.5-turbo-0613':           { prompt: 1.5,  completion: 2.0 },
  'gpt-3.5-0301':                 { prompt: 1.5,  completion: 2.0 },
  'gpt-3.5-turbo-instruct':       { prompt: 1.5,  completion: 2.0 },
  'gpt-3.5-turbo-16k-0613':       { prompt: 3.0,  completion: 4.0 },
  'davinci-002':                  { prompt: 2.0,  completion: 2.0 },
  'babbage-002':                  { prompt: 0.4,  completion: 0.4 },
  // ── Anthropic: Claude 4.x (aliases + dated variants) ─────────────────────
  'claude-opus-4-7':              { prompt: 5,    completion: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-opus-4-6':              { prompt: 5,    completion: 25, cacheRead: 0.5,  cacheWrite: 6.25 }, // alias only; no dated form per docs
  'claude-opus-4-5':              { prompt: 5,    completion: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-opus-4-5-20251101':     { prompt: 5,    completion: 25, cacheRead: 0.5,  cacheWrite: 6.25 },
  'claude-opus-4-1':              { prompt: 15,   completion: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-opus-4-1-20250805':     { prompt: 15,   completion: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-opus-4':                { prompt: 15,   completion: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-opus-4-0':              { prompt: 15,   completion: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-opus-4-20250514':       { prompt: 15,   completion: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-sonnet-4-6':            { prompt: 3,    completion: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-sonnet-4-5':            { prompt: 3,    completion: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-sonnet-4-5-20250929':   { prompt: 3,    completion: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-sonnet-4':              { prompt: 3,    completion: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-sonnet-4-0':            { prompt: 3,    completion: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-sonnet-4-20250514':     { prompt: 3,    completion: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-haiku-4.5':             { prompt: 1,    completion: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  'claude-haiku-4-5':             { prompt: 1,    completion: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  'claude-haiku-4-5-20251001':    { prompt: 1,    completion: 5,  cacheRead: 0.1,  cacheWrite: 1.25 },
  // ── Anthropic: Claude 3.x ────────────────────────────────────────────────
  'claude-3-5-sonnet-20241022':   { prompt: 3,    completion: 15, cacheRead: 0.3,  cacheWrite: 3.75 },
  'claude-3-5-haiku-20241022':    { prompt: 0.8,  completion: 4,  cacheRead: 0.08, cacheWrite: 1.0 },
  'claude-3-opus-20240229':       { prompt: 15,   completion: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  'claude-3-haiku-20240307':      { prompt: 0.25, completion: 1.25 }, // retired 2026-04-19, no cache
  // ── Gemini 3.x (Pro family has >200k tier) ───────────────────────────────
  'gemini-3.5-flash':                       { prompt: 1.5,  completion: 9 },
  'gemini-3.1-pro-preview':                 { prompt: 2.0,  completion: 12,
                                              longThreshold: 200000, longPrompt: 4, longCompletion: 18 },
  'gemini-3.1-pro-preview-customtools':     { prompt: 2.0,  completion: 12,
                                              longThreshold: 200000, longPrompt: 4, longCompletion: 18 },
  'gemini-3.1-flash-lite':                  { prompt: 0.25, completion: 1.5 },
  'gemini-3.1-flash-lite-preview':          { prompt: 0.25, completion: 1.5 },
  'gemini-3-flash-preview':                 { prompt: 0.5,  completion: 3 },
  // ── Gemini 2.5 (Pro + Computer Use have >200k tier) ──────────────────────
  'gemini-2.5-pro':                         { prompt: 1.25, completion: 10,
                                              longThreshold: 200000, longPrompt: 2.5, longCompletion: 15 },
  'gemini-2.5-flash':                       { prompt: 0.3,  completion: 2.5 },
  'gemini-2.5-flash-lite':                  { prompt: 0.1,  completion: 0.4 },
  'gemini-2.5-flash-lite-preview-09-2025':  { prompt: 0.1,  completion: 0.4 },
  'gemini-2.5-computer-use-preview-10-2025': { prompt: 1.25, completion: 10,
                                              longThreshold: 200000, longPrompt: 2.5, longCompletion: 15 },
  // ── Gemini 2.0 / 1.5 ─────────────────────────────────────────────────────
  'gemini-2.0-flash':      { prompt: 0.1,   completion: 0.4 },
  'gemini-2.0-flash-lite': { prompt: 0.075, completion: 0.3 },
  'gemini-1.5-pro':        { prompt: 1.25,  completion: 5 },
  'gemini-1.5-flash':      { prompt: 0.075, completion: 0.3 },
}

// ── Cache state ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes
const ERROR_LOG_THROTTLE_MS = 60 * 1000  // log refresh failures at most once / min

let cache: Record<string, ModelPrice> = { ...FALLBACK_PRICES }
let lastRefreshedAt = 0
let refreshInFlight: Promise<void> | null = null
let lastErrorLoggedAt = 0

/**
 * Synchronous price lookup map. Always returns a non-empty record (worst case:
 * the FALLBACK_PRICES). Triggers an async refresh if the cache is stale.
 *
 * Safe to call on every request — never throws, never awaits.
 */
export function getCachedPrices(): Record<string, ModelPrice> {
  maybeTriggerRefresh()
  return cache
}

/**
 * Force a synchronous refresh. Used by:
 *   - Admin API after mutations (so the response reflects the new price)
 *   - Tests
 *
 * Returns whether the refresh succeeded. Errors are caught and the cache
 * stays at its previous value.
 */
export async function refreshPricesNow(): Promise<boolean> {
  try {
    await doRefresh()
    return true
  } catch (err) {
    logRefreshError(err)
    return false
  }
}

/**
 * Reset cache to fallback values. Test helper only — production code
 * never needs to reset because the cache self-refreshes.
 */
export function _resetCacheForTests(): void {
  cache = { ...FALLBACK_PRICES }
  lastRefreshedAt = 0
  refreshInFlight = null
}

// ── Internals ─────────────────────────────────────────────────────────────────

function maybeTriggerRefresh(): void {
  // In tests we don't have a real Supabase — skip the network call so test
  // output stays clean. Direct callers (refreshPricesNow) still work, so
  // tests that explicitly want to exercise the refresh path can do so.
  if (process.env['VITEST']) return

  const now = Date.now()
  const stale = now - lastRefreshedAt > CACHE_TTL_MS

  if (!stale) return
  if (refreshInFlight) return

  // Fire and forget — caller does NOT await. Errors logged, cache stays valid.
  refreshInFlight = doRefresh()
    .catch(logRefreshError)
    .finally(() => {
      refreshInFlight = null
    })
}

async function doRefresh(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('model_prices')
    .select(
      'model, prompt_price_per_1m, completion_price_per_1m, cache_read_price_per_1m, cache_write_price_per_1m,' +
      ' long_context_threshold_tokens, long_prompt_price_per_1m, long_completion_price_per_1m,' +
      ' long_cache_read_price_per_1m, long_cache_write_price_per_1m',
    )

  if (error) throw new Error(`model_prices fetch failed: ${error.message}`)
  if (!data || data.length === 0) {
    // Empty table — keep fallback values, but mark refresh as done so we
    // don't hammer the DB. Operator action required (seed the table).
    lastRefreshedAt = Date.now()
    return
  }

  const next: Record<string, ModelPrice> = {}
  for (const row of data) {
    // Row type is loose because long_* columns may not exist in types.ts yet
    // (added in migration 20260522010000; types.ts regenerates on next gen).
    // Guard each access so a stale types.ts doesn't break the refresh.
    const r = row as Record<string, unknown>
    next[row.model] = {
      prompt: Number(row.prompt_price_per_1m),
      completion: Number(row.completion_price_per_1m),
      ...(row.cache_read_price_per_1m != null && { cacheRead: Number(row.cache_read_price_per_1m) }),
      ...(row.cache_write_price_per_1m != null && { cacheWrite: Number(row.cache_write_price_per_1m) }),
      ...(r['long_context_threshold_tokens'] != null && {
        longThreshold: Number(r['long_context_threshold_tokens']),
      }),
      ...(r['long_prompt_price_per_1m'] != null && {
        longPrompt: Number(r['long_prompt_price_per_1m']),
      }),
      ...(r['long_completion_price_per_1m'] != null && {
        longCompletion: Number(r['long_completion_price_per_1m']),
      }),
      ...(r['long_cache_read_price_per_1m'] != null && {
        longCacheRead: Number(r['long_cache_read_price_per_1m']),
      }),
      ...(r['long_cache_write_price_per_1m'] != null && {
        longCacheWrite: Number(r['long_cache_write_price_per_1m']),
      }),
    }
  }
  // Merge with fallback so any model present in fallback but missing from DB
  // still resolves (avoids regression if an admin accidentally deletes a row).
  cache = { ...FALLBACK_PRICES, ...next }
  lastRefreshedAt = Date.now()
}

function logRefreshError(err: unknown): void {
  const now = Date.now()
  if (now - lastErrorLoggedAt < ERROR_LOG_THROTTLE_MS) return
  lastErrorLoggedAt = now
  console.warn('[model-prices-cache] refresh failed, using stale/fallback prices:', err)
}
