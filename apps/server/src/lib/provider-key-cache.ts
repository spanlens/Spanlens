import { supabaseAdmin } from './db.js'

/**
 * The **ciphertext** row backing one (Spanlens key, provider) pair.
 *
 * `encryptedKey` is `provider_keys.encrypted_key` verbatim — the AES-256-GCM
 * ciphertext, never the decrypted provider credential. See the comment block
 * below for why that distinction is the whole point of this module.
 */
export interface CachedProviderKeyRow {
  id: string
  encryptedKey: string
  metadata: Record<string, unknown>
}

// ── P3.2: provider-key row cache (in-memory, per-instance) ───────────────
//
// getDecryptedProviderKey() runs once per proxied LLM call, for every
// provider, and used to hit `provider_keys` on every single request. It
// was the last uncached Supabase round-trip left on the proxy hot path
// (authApiKey.ts caches the API-key lookup, lib/quota.ts caches quota
// settings + the monthly count) and it sits *before* the upstream fetch,
// so its ~30-80ms landed directly in customer-visible latency.
//
// Choices the comments unpack:
//
//   - **We cache ciphertext, never plaintext.** CLAUDE.md "보안 규칙" rule 3
//     requires the decrypted provider key to be produced, handed to the
//     upstream Authorization header, and dropped — never stashed. So this
//     cache stores exactly what the DB stores, and every request still
//     calls aes256Decrypt() on the way out (see proxy/utils.ts). That
//     costs microseconds of CPU; the round-trip we removed cost tens of
//     milliseconds of network. A process memory dump of this Map yields
//     the same ciphertext an attacker could already read from the DB —
//     it does not yield a usable OpenAI/Anthropic credential.
//
//   - Map + FIFO eviction, cap 1000, mirroring the API-key cache in
//     middleware/authApiKey.ts. Insertion-order eviction is not a true
//     LRU, but at this cap the working set fits and the difference is
//     invisible. Deliberately the same shape as authApiKey so there is
//     one cache idiom on the hot path, not two.
//
//   - Cache key is `${apiKeyId}:${provider}`. apiKeyId is a UUID resolved
//     by authApiKey from the presented sl_live_* key, so entries cannot
//     collide across tenants.
//
//   - Differentiated TTLs: 30s for a hit, 5s for a miss. The 30s matches
//     the full-scope API-key cache, so a revoked credential's worst-case
//     shadow is one window, not two stacked windows. The negative TTL is
//     deliberately shorter: a miss only ever produces a denial, so it is
//     not a security window at all — its job is purely to stop a
//     misconfigured client's retry loop from hammering Supabase. A few
//     seconds flattens that load completely. Keeping it short also means
//     a customer who has just registered their first provider key sees
//     the proxy start working almost immediately, even on an instance
//     that never observed the invalidation below (invalidation is
//     process-local; see the next point). A 30s negative TTL would turn
//     "I added my key but the proxy still says none is configured" into
//     a support ticket for a cache we added purely for latency.
//
//   - In-flight coalescing: a burst of concurrent proxy requests for the
//     same key collapses onto one Supabase query instead of N (same
//     pattern as getOrgPlan in requests-query.ts and the quota caches).
//
//   - The cache is **process-local**. It lives in one Vercel serverless
//     instance's memory and dies with it — this is NOT a distributed
//     cache, and nothing here is shared between instances or regions.
//     That is intentional: a shared Redis cache would buy more hit-rate
//     at the price of another failure mode on the hottest path. The
//     consequence to keep in mind is that invalidation is also
//     process-local: an instance that never handled the mutation still
//     serves its own entry until the TTL expires, which is why the
//     positive TTL is kept at 30s.
//
//   - Invalidation is explicit and epoch-guarded. invalidateProviderKeyCache
//     is called from every path that creates, rotates, deactivates,
//     reactivates or deletes a provider key (including the api_keys
//     cascade), so a rotated credential cannot keep reaching upstream for
//     the rest of the TTL on the instance that served the mutation. The
//     epoch counter closes the companion race: a SELECT that was already
//     in flight when the mutation landed must not be allowed to write its
//     now-stale row back into the Map with a fresh 30s lease.

const providerKeyCache = new Map<
  string,
  { value: CachedProviderKeyRow | null; expiresAt: number }
>()
const providerKeyInflight = new Map<string, Promise<CachedProviderKeyRow | null>>()

const CACHE_TTL_MS = 30_000 // hit — matches the sl_live_* auth cache
const NEGATIVE_CACHE_TTL_MS = 5_000 // miss — anti-hammering only, see above
const CACHE_MAX_ENTRIES = 1000

/**
 * Bumped by every invalidation. A fetch captures it before querying and
 * refuses to populate the cache if it changed while the query was in
 * flight — otherwise a mutation that lands mid-SELECT would be papered
 * over by the stale row arriving a few milliseconds later.
 */
let invalidationEpoch = 0

function cacheKeyFor(apiKeyId: string, provider: string): string {
  return `${apiKeyId}:${provider}`
}

function getCachedRow(
  key: string,
): { value: CachedProviderKeyRow | null } | null {
  const entry = providerKeyCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    providerKeyCache.delete(key)
    return null
  }
  return entry
}

function setCachedRow(key: string, value: CachedProviderKeyRow | null): void {
  if (providerKeyCache.size >= CACHE_MAX_ENTRIES) {
    // FIFO eviction — Map iteration order is insertion order, so the
    // first key is the oldest. Good enough at this cap (see above).
    const firstKey = providerKeyCache.keys().next().value
    if (firstKey) providerKeyCache.delete(firstKey)
  }
  const ttl = value === null ? NEGATIVE_CACHE_TTL_MS : CACHE_TTL_MS
  providerKeyCache.set(key, { value, expiresAt: Date.now() + ttl })
}

/**
 * Resolve the active provider-key **ciphertext** row for a Spanlens key +
 * provider, from cache when possible.
 *
 * Returns null when no active row exists (that null is itself cached, for
 * the shorter negative TTL). Callers decrypt — this module never does.
 */
export async function loadProviderKeyRow(
  apiKeyId: string,
  provider: string,
): Promise<CachedProviderKeyRow | null> {
  const key = cacheKeyFor(apiKeyId, provider)

  const cached = getCachedRow(key)
  if (cached) return cached.value

  // Coalesce concurrent callers onto one round-trip. Note we intentionally
  // do NOT evict this in-flight entry on invalidation: a caller that joined
  // a SELECT already running when the mutation landed simply read the row
  // as of a moment before the write, which is an ordinary read/write race
  // rather than a cache defect. The epoch guard below stops that same
  // result from being *persisted*, which is the part that would actually
  // extend a revoked key's life.
  const existing = providerKeyInflight.get(key)
  if (existing) return existing

  const startedEpoch = invalidationEpoch
  const fetchPromise = (async (): Promise<CachedProviderKeyRow | null> => {
    try {
      const { data } = await supabaseAdmin
        .from('provider_keys')
        .select('id, encrypted_key, provider_metadata')
        .eq('api_key_id', apiKeyId)
        .eq('provider', provider)
        .eq('is_active', true)
        .maybeSingle()

      const row: CachedProviderKeyRow | null = data
        ? {
            id: data.id as string,
            encryptedKey: data.encrypted_key as string,
            metadata:
              (data.provider_metadata as Record<string, unknown> | null) ?? {},
          }
        : null

      if (invalidationEpoch === startedEpoch) setCachedRow(key, row)
      return row
    } finally {
      providerKeyInflight.delete(key)
    }
  })()
  providerKeyInflight.set(key, fetchPromise)
  return fetchPromise
}

/**
 * Invalidate cached provider-key rows.
 *
 * Call this from every mutation that changes which ciphertext a
 * (Spanlens key, provider) pair resolves to: registration, rotation,
 * rename, deactivate, reactivate, delete, and the `api_keys` delete
 * cascade. Without it, a rotated or revoked credential would keep being
 * handed to the upstream provider for the rest of the 30s TTL on the
 * instance that served the mutation — the exact incident the cache is
 * otherwise designed to avoid.
 *
 * Pass `provider` when the caller knows it (the precise form, and the
 * only form that can also clear a cached *miss*). Omit it to drop every
 * provider under one Spanlens key, which is what the `api_keys` delete
 * cascade needs — deleting an api_keys row takes all of its nested
 * provider_keys rows with it (ON DELETE CASCADE, migration
 * 20260505080000) and the caller has no list of which providers those were.
 */
export function invalidateProviderKeyCache(
  apiKeyId: string,
  provider?: string,
): void {
  invalidationEpoch += 1

  if (provider) {
    providerKeyCache.delete(cacheKeyFor(apiKeyId, provider))
    return
  }

  const prefix = `${apiKeyId}:`
  for (const key of providerKeyCache.keys()) {
    if (key.startsWith(prefix)) providerKeyCache.delete(key)
  }
}

/**
 * Invalidate by `provider_keys.id` for callers that only hold the row
 * UUID — the soft-delete drain paths in lib/pending-deletions.ts, which
 * receive `(resourceType, resourceId, organizationId)` and never see the
 * owning api_key_id.
 *
 * Implemented as a scan over the Map. The cache is capped at 1000 entries
 * and these are cold admin/cron paths, so the scan is microseconds; a
 * secondary id→key index would cost bookkeeping on the hot path to save
 * nothing measurable on a cold one.
 *
 * Note this cannot clear a cached *miss* (a negative entry has no row id
 * to match on). Callers that reactivate a key — where the stale entry is
 * precisely a miss — should use invalidateProviderKeyCache(apiKeyId,
 * provider) instead; the negative TTL of 5s bounds the fallback case.
 */
export function invalidateProviderKeyCacheByRowId(providerKeyId: string): void {
  invalidationEpoch += 1
  for (const [key, entry] of providerKeyCache) {
    if (entry.value?.id === providerKeyId) providerKeyCache.delete(key)
  }
}

/** Test-only helper. Production never calls this. */
export function _clearProviderKeyCacheForTests(): void {
  providerKeyCache.clear()
  providerKeyInflight.clear()
  invalidationEpoch = 0
}
