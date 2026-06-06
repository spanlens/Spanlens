import { supabaseAdmin } from './db.js'

/**
 * Throttled writer for `api_keys.last_used_at`.
 *
 * Every authenticated proxy call lands in authApiKey, which validates the
 * key against the DB. Recording "this key just authenticated" on every hit
 * would translate to one UPDATE per proxy call — at the rate the proxy
 * runs that's a lot of pointless writes. We cap it to one UPDATE per key
 * per `THROTTLE_MS`, in-memory per process. Slightly inaccurate (different
 * Vercel instances start with empty caches and may double-write within
 * the same window) but the DB UPDATE itself is idempotent and the cost is
 * bounded by `instances * keys / THROTTLE_MS`, which is small.
 *
 * The cache is bounded too: at MAX_ENTRIES it stops accepting new entries
 * and any further calls just no-op until the existing entries TTL out
 * (i.e. THROTTLE_MS later, when next write would fire anyway). Insertion
 * order is preserved by Map so we don't grow without bound.
 */

const THROTTLE_MS = 5 * 60 * 1000
const MAX_ENTRIES = 10_000

const lastWriteAt = new Map<string, number>()

/**
 * Returns true when `apiKeyId` is due for a `last_used_at` refresh, false
 * when the in-memory throttle says we already refreshed it recently.
 *
 * Side effect: when this returns true it stamps the cache, so the next
 * call within THROTTLE_MS returns false. Callers should immediately
 * follow up with the actual UPDATE (or call {@link maybeStampLastUsed}
 * which does both).
 */
function shouldStamp(apiKeyId: string): boolean {
  const now = Date.now()
  const last = lastWriteAt.get(apiKeyId)
  if (last !== undefined && now - last < THROTTLE_MS) return false

  if (last === undefined && lastWriteAt.size >= MAX_ENTRIES) {
    // Cache is full of cold entries. Drop the oldest to make room for this
    // new key — Map preserves insertion order, so first key is oldest.
    const oldest = lastWriteAt.keys().next().value
    if (oldest !== undefined) lastWriteAt.delete(oldest)
  }

  lastWriteAt.set(apiKeyId, now)
  return true
}

/**
 * Fire the UPDATE if the in-memory throttle allows it. Returns the
 * promise so callers in a `fireAndForget` context can hand it off; await
 * is only meaningful in tests.
 *
 * If the throttle says skip, returns a resolved promise so callers can
 * uniformly `await` without branching.
 */
export async function maybeStampLastUsed(apiKeyId: string): Promise<void> {
  if (!shouldStamp(apiKeyId)) return

  const { error } = await supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', apiKeyId)

  if (error) {
    // Audit-style helpers swallow errors; this is a UX-only write, never
    // worth aborting a request over. Surface to logs and move on.
    console.error('[api-key-last-used] update failed:', error.message)
  }
}

/** Test-only: reset the throttle cache between cases. */
export function _resetLastUsedCacheForTests(): void {
  lastWriteAt.clear()
}

/** Test-only: probe the cache without mutating it. */
export function _cacheSizeForTests(): number {
  return lastWriteAt.size
}

/** Test-only: expose the throttle window so test fixtures stay in sync. */
export const _THROTTLE_MS_FOR_TESTS = THROTTLE_MS
