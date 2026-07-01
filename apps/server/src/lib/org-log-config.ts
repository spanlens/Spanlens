/**
 * Per-organization logging configuration, cached for the proxy hot path.
 *
 * Currently just the request-body sampling rate (organizations.body_sample_rate).
 * logRequestAsync runs on every proxy request, so this is cached in-process with
 * a short TTL to avoid a Supabase round-trip per log write. Fail-open: on a
 * lookup failure we return 1.0 (store the body), which preserves the historical
 * behavior — we never silently drop a body because a config read hiccuped.
 */

import { supabaseAdmin } from './db.js'

const CACHE_TTL_MS = 60_000

interface CacheEntry {
  rate: number
  at: number
}

const cache = new Map<string, CacheEntry>()

/** Clamp any input to the valid sample-rate range [0, 1]. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1.0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/** Clear the cache. Call after an org updates its logging config. */
export function resetOrgLogConfigCache(orgId?: string): void {
  if (orgId) cache.delete(orgId)
  else cache.clear()
}

/**
 * Resolve the org's body sample rate (fraction of requests whose bodies are
 * stored). Cached for {@link CACHE_TTL_MS}. Returns 1.0 (store everything) on
 * cache miss + lookup failure so a Supabase blip never drops customer bodies.
 */
export async function getOrgBodySampleRate(orgId: string): Promise<number> {
  const now = Date.now()
  const hit = cache.get(orgId)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.rate

  try {
    const { data, error } = await supabaseAdmin
      .from('organizations')
      .select('body_sample_rate')
      .eq('id', orgId)
      .maybeSingle()
    if (error || !data) {
      // Cache the default briefly so a persistent lookup failure doesn't
      // hammer Supabase on every log write.
      cache.set(orgId, { rate: 1.0, at: now })
      return 1.0
    }
    const raw = (data as { body_sample_rate?: unknown }).body_sample_rate
    const rate = clamp01(Number(raw ?? 1))
    cache.set(orgId, { rate, at: now })
    return rate
  } catch {
    return 1.0
  }
}

/**
 * Decide whether to store the body for one request. Bodies are stored when the
 * caller is in 'full' logBody mode AND the random draw falls within the sample
 * rate. `rng` is injectable for tests; production passes Math.random().
 */
export function shouldStoreBody(fullMode: boolean, sampleRate: number, rng: number): boolean {
  if (!fullMode) return false
  if (sampleRate >= 1) return true
  if (sampleRate <= 0) return false
  return rng < sampleRate
}
