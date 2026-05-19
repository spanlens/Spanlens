import type { Context } from 'hono'
import { Redis } from '@upstash/redis'
import { fireAndForget } from './wait-until.js'

/**
 * Stale-while-revalidate (SWR) cache for ClickHouse aggregate queries.
 *
 *   - fresh window  → return cached as-is
 *   - stale window  → return cached AND refresh in background
 *   - beyond stale  → Redis TTL expires the row; next caller does a sync load
 *
 * Fails open: if Redis is unavailable or errors, the loader is called directly.
 *
 * Tenancy: the caller is responsible for including `orgId` in `key`. Code
 * review must verify every withStatsCache() call uses a key that starts with
 * `org:<orgId>:` — see docs/plans/dashboard-load-perf-2026-05.md §4.
 *
 * Vercel note: redis.set() must run through `fireAndForget(c, ...)` instead
 * of `.catch()`. Without it Vercel drops the pending Redis write the moment
 * the handler returns, so cache hits never accumulate. See CLAUDE.md
 * gotcha #8 — same root cause as the proxy logger race.
 */

let _redis: Redis | null = null

function getRedis(): Redis | null {
  if (_redis) return _redis
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) return null
  _redis = new Redis({ url, token })
  return _redis
}

interface CacheEntry<T> {
  data: T
  cachedAt: number // Unix ms
}

export interface SwrOptions {
  /** Within this age (seconds), data is considered fresh — return as-is. */
  freshSeconds: number
  /** Beyond fresh but within this age, return stale + refresh in background.
   *  Used as the Redis TTL too — entries older than this are gone. */
  staleSeconds: number
}

// In-flight background refresh dedup — prevents a thundering herd when many
// concurrent requests hit the same stale key. The map is per-Lambda-instance;
// different instances may each fire one refresh, but ClickHouse load is
// bounded and the results converge.
const _inflight = new Map<string, Promise<unknown>>()

function refreshInBackground<T>(
  c: Context,
  redis: Redis,
  key: string,
  staleSeconds: number,
  loader: () => Promise<T>,
): void {
  if (_inflight.has(key)) return
  const p = (async () => {
    try {
      const fresh = await loader()
      const entry: CacheEntry<T> = { data: fresh, cachedAt: Date.now() }
      await redis.set(key, entry, { ex: staleSeconds })
    } catch (err) {
      console.warn('[stats-cache] background refresh failed:', err)
    } finally {
      _inflight.delete(key)
    }
  })()
  _inflight.set(key, p)
  fireAndForget(c, p)
}

/**
 * Wraps a ClickHouse aggregate query with SWR caching.
 *
 *   `c`       Hono context — required to keep Redis writes alive on Vercel
 *             (see CLAUDE.md gotcha #8).
 *   `key`     must include orgId for tenant isolation.
 *   `opts`    fresh/stale window in seconds (see {@link STATS_SWR}).
 *   `loader`  the actual query function — invoked only on cache miss / refresh.
 *
 * Returns the cached value (fresh or stale) or the loader's fresh result.
 */
// DIAG: prove Redis round-trip works. One-shot per Lambda cold start.
let _roundtripChecked = false
async function checkRoundtrip(redis: Redis): Promise<void> {
  if (_roundtripChecked) return
  _roundtripChecked = true
  const k = 'spanlens:diag:roundtrip:' + Date.now()
  try {
    await redis.set(k, { hello: 'world', ts: Date.now() }, { ex: 30 })
    const back = await redis.get(k)
    console.log('[stats-cache] diag: roundtrip', {
      backType: typeof back,
      backIsNull: back === null,
      backJson: back === null ? null : JSON.stringify(back).slice(0, 200),
    })
  } catch (err) {
    console.error('[stats-cache] diag: roundtrip failed:', err)
  }
}

export async function withStatsCache<T>(
  c: Context,
  key: string,
  opts: SwrOptions,
  loader: () => Promise<T>,
): Promise<T> {
  const redis = getRedis()
  if (!redis) {
    console.log('[stats-cache] diag: no-redis', { key: key.slice(0, 60) })
    return loader()
  }
  // Fires once per Lambda cold start, proves SET→GET round-trip works.
  fireAndForget(c, checkRoundtrip(redis))

  let entry: CacheEntry<T> | null = null
  try {
    entry = await redis.get<CacheEntry<T>>(key)
  } catch (err) {
    console.warn('[stats-cache] read error — failing open:', err)
    return loader()
  }

  if (entry) {
    const ageSeconds = (Date.now() - entry.cachedAt) / 1000

    if (ageSeconds < opts.freshSeconds) {
      console.log('[stats-cache] diag: hit-fresh', { key: key.slice(0, 60), ageSeconds })
      return entry.data
    }

    if (ageSeconds < opts.staleSeconds) {
      console.log('[stats-cache] diag: hit-stale', { key: key.slice(0, 60), ageSeconds })
      refreshInBackground(c, redis, key, opts.staleSeconds, loader)
      return entry.data
    }
    // Beyond stale (defensive — should already be expired by Redis TTL).
  }

  console.log('[stats-cache] diag: miss', { key: key.slice(0, 60), entryWasNull: entry === null, ttl: opts.staleSeconds })
  const fresh = await loader()
  const newEntry: CacheEntry<T> = { data: fresh, cachedAt: Date.now() }
  // Must NOT use .catch() — Vercel drops the pending promise on handler
  // return. fireAndForget routes through @vercel/functions waitUntil.
  fireAndForget(c, (async () => {
    try {
      const result = await redis.set(key, newEntry, { ex: opts.staleSeconds })
      console.log('[stats-cache] diag: write-ok', { key: key.slice(0, 60), result })
    } catch (err) {
      console.error('[stats-cache] diag: write-failed', { key: key.slice(0, 60), err: String(err) })
      throw err
    }
  })())
  return fresh
}

/** Default SWR window for stats endpoints — 10s fresh / 60s stale. */
export const STATS_SWR: SwrOptions = { freshSeconds: 10, staleSeconds: 60 }

/** Slower-changing data (e.g. spend forecast) — 60s fresh / 300s stale. */
export const STATS_SWR_SLOW: SwrOptions = { freshSeconds: 60, staleSeconds: 300 }
