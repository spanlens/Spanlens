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
}

// Prices in USD per 1M tokens (verified against provider pricing pages 2026-05).
// This map is the COLD-START FALLBACK — used when the DB cache is empty
// (first request after deploy / DB unreachable). The DB is the source of truth
// once loaded; this constant exists to guarantee `calculateCost()` always has
// a valid map to read.
//
// Cache rates:
//   • Anthropic — cache_read = 0.1 × input, cache_write (5min) = 1.25 × input
//   • OpenAI    — cached input ≈ 0.5 × input (gpt-4o / gpt-4.1 families)
export const FALLBACK_PRICES: Record<string, ModelPrice> = {
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
  'gemini-2.0-flash':      { prompt: 0.1,   completion: 0.4 },
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
    .select('model, prompt_price_per_1m, completion_price_per_1m, cache_read_price_per_1m, cache_write_price_per_1m')

  if (error) throw new Error(`model_prices fetch failed: ${error.message}`)
  if (!data || data.length === 0) {
    // Empty table — keep fallback values, but mark refresh as done so we
    // don't hammer the DB. Operator action required (seed the table).
    lastRefreshedAt = Date.now()
    return
  }

  const next: Record<string, ModelPrice> = {}
  for (const row of data) {
    next[row.model] = {
      prompt: Number(row.prompt_price_per_1m),
      completion: Number(row.completion_price_per_1m),
      ...(row.cache_read_price_per_1m != null && { cacheRead: Number(row.cache_read_price_per_1m) }),
      ...(row.cache_write_price_per_1m != null && { cacheWrite: Number(row.cache_write_price_per_1m) }),
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
