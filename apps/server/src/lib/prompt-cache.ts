import { Redis } from '@upstash/redis'

/**
 * Prompt resolve cache (Upstash Redis).
 *
 * The proxy hot path calls resolvePromptVersion() on every request that
 * carries an X-Spanlens-Prompt-Version header. Each call does 1-2 Supabase
 * queries (RLS bypassed by service role, but still ~5-20ms network + parse).
 * Caching cuts that to ~1ms Redis hit.
 *
 * Cache keys (all prefixed `spanlens:prompt:`):
 *   uuid:<orgId>:<uuid>           → versionId existence (string)
 *   nv:<orgId>:<name>:<version>   → versionId (string)
 *   latest:<orgId>:<name>         → JSON { versionId, experimentId?, experimentArm? }
 *
 * Invalidation strategy:
 *   - Writes to a prompt (create, delete, A/B start/stop) acquire a write
 *     lock for that (org, name), then SCAN-delete all keys for that name.
 *   - Reads check the write lock; if held, skip the cache entirely (read
 *     fresh from DB) so they never serve a stale value during invalidation.
 *
 * Why Lua: Upstash Free silently drops raw redis.set() in some configurations
 * (CLAUDE.md gotcha #24). All writes go through EVAL so they survive Free tier
 * and we benefit from atomic multi-step operations.
 *
 * Fail-open: any Redis error or missing env returns null on read / no-op on
 * write. The proxy must never be blocked by a cache outage.
 */

const KEY_PREFIX = 'spanlens:prompt:'
const LOCK_TTL_SECONDS = 10
const VALUE_TTL_SECONDS = 300 // 5 min — invalidate-on-write is the real freshness mechanism
const SCAN_BATCH_SIZE = 100

let _redis: Redis | null = null

/**
 * Lazy Upstash Redis singleton. Returns null when env is missing — local
 * dev and preview environments often run without KV configured, and the
 * prompt-cache call sites already handle null (skip the cache).
 *
 * Exported so /health/ready (R-22) can ping the same instance instead of
 * spinning up its own client. Keep this the only constructor of the
 * shared Redis singleton to avoid drift between callers.
 */
export function getRedis(): Redis | null {
  if (_redis) return _redis

  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN

  if (!url || !token) return null

  _redis = new Redis({ url, token })
  return _redis
}

// ---------------------------------------------------------------------------
// Key builders
// ---------------------------------------------------------------------------

function uuidKey(orgId: string, uuid: string): string {
  return `${KEY_PREFIX}uuid:${orgId}:${uuid}`
}

function nameVersionKey(orgId: string, name: string, version: number): string {
  return `${KEY_PREFIX}nv:${orgId}:${name}:${version}`
}

function latestKey(orgId: string, name: string): string {
  return `${KEY_PREFIX}latest:${orgId}:${name}`
}

function lockKey(orgId: string, name: string): string {
  return `${KEY_PREFIX}lock:${orgId}:${name}`
}

function namePattern(orgId: string, name: string): string {
  // Matches nv:<orgId>:<name>:* and latest:<orgId>:<name>. UUID keys aren't
  // name-scoped so they expire via TTL when a version is renamed/removed.
  return `${KEY_PREFIX}{nv,latest}:${orgId}:${name}*`
}

// ---------------------------------------------------------------------------
// Lua scripts
// ---------------------------------------------------------------------------

/**
 * Atomic read-with-lock-check.
 *   KEYS[1] = value key
 *   KEYS[2] = lock key
 * Returns: the value, or false if locked / missing.
 */
const READ_IF_UNLOCKED = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return false
end
return redis.call('GET', KEYS[1])
`

/**
 * Atomic set-if-unlocked. Skips the write when an invalidation lock is held
 * so we don't race a fresher write.
 *   KEYS[1] = value key
 *   KEYS[2] = lock key
 *   ARGV[1] = value
 *   ARGV[2] = TTL seconds
 */
const SET_IF_UNLOCKED = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
return 1
`

/**
 * Take a write lock + SCAN-delete keys matching a prefix in one EVAL.
 *   KEYS[1] = lock key
 *   ARGV[1] = lock TTL seconds
 *   ARGV[2] = nv prefix to delete (spanlens:prompt:nv:<orgId>:<name>:)
 *   ARGV[3] = latest key (spanlens:prompt:latest:<orgId>:<name>)
 *   ARGV[4] = scan batch size
 *
 * Returns the number of keys deleted.
 */
const INVALIDATE = `
redis.call('SET', KEYS[1], '1', 'EX', tonumber(ARGV[1]))
redis.call('DEL', ARGV[3])
local deleted = 1
local cursor = '0'
repeat
  local result = redis.call('SCAN', cursor, 'MATCH', ARGV[2] .. '*', 'COUNT', tonumber(ARGV[4]))
  cursor = result[1]
  local keys = result[2]
  if #keys > 0 then
    deleted = deleted + redis.call('DEL', unpack(keys))
  end
until cursor == '0'
return deleted
`

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Cached state for a `name@latest` lookup.
 *
 * - `kind: 'single'` → no experiment running; serve `versionId` directly.
 * - `kind: 'experiment'` → A/B running; the caller must re-run the routing
 *   hash locally on every request to preserve the deterministic-per-trace
 *   split. We deliberately do NOT cache the arm decision because that would
 *   force every cache hit to the same arm and destroy the split.
 */
export type CachedLatest =
  | { kind: 'single'; versionId: string }
  | {
      kind: 'experiment'
      experimentId: string
      versionAId: string
      versionBId: string
      trafficSplit: number
    }

/**
 * Read a UUID-keyed cache entry. Returns the versionId if it was previously
 * confirmed to belong to the org, null otherwise. The "lock" for UUID lookups
 * isn't name-scoped (we don't know the name), so we just do a plain GET.
 */
export async function getCachedUuid(orgId: string, uuid: string): Promise<string | null> {
  const redis = getRedis()
  if (!redis) return null

  try {
    const value = await redis.get<string>(uuidKey(orgId, uuid))
    return typeof value === 'string' ? value : null
  } catch (err) {
    console.error('[prompt-cache] getCachedUuid failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function setCachedUuid(orgId: string, uuid: string, versionId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  try {
    await redis.set(uuidKey(orgId, uuid), versionId, { ex: VALUE_TTL_SECONDS })
  } catch (err) {
    console.error('[prompt-cache] setCachedUuid failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Read name+version cache. Honours the invalidation lock for this (org, name).
 */
export async function getCachedNameVersion(
  orgId: string,
  name: string,
  version: number,
): Promise<string | null> {
  const redis = getRedis()
  if (!redis) return null

  try {
    const value = await redis.eval(
      READ_IF_UNLOCKED,
      [nameVersionKey(orgId, name, version), lockKey(orgId, name)],
      [],
    )
    return typeof value === 'string' ? value : null
  } catch (err) {
    console.error('[prompt-cache] getCachedNameVersion failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function setCachedNameVersion(
  orgId: string,
  name: string,
  version: number,
  versionId: string,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  try {
    await redis.eval(
      SET_IF_UNLOCKED,
      [nameVersionKey(orgId, name, version), lockKey(orgId, name)],
      [versionId, String(VALUE_TTL_SECONDS)],
    )
  } catch (err) {
    console.error('[prompt-cache] setCachedNameVersion failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Read the latest-version cache for a prompt name. Honours the invalidation
 * lock. The value is a JSON-encoded {@link CachedLatest}.
 *
 * Note: `@upstash/redis` runs `automaticDeserialization` on every response —
 * including EVAL returns. A JSON-stringified payload comes back as a parsed
 * object, not the raw string. We accept both shapes and route through
 * `parseCachedLatest()` so the validator stays in one place.
 *
 * The Lua script returns `false` when the lock is held; the SDK surfaces
 * that as JS `false`, so we explicitly bail before re-stringifying.
 */
export async function getCachedLatest(
  orgId: string,
  name: string,
): Promise<CachedLatest | null> {
  const redis = getRedis()
  if (!redis) return null

  try {
    const raw = await redis.eval(
      READ_IF_UNLOCKED,
      [latestKey(orgId, name), lockKey(orgId, name)],
      [],
    )
    if (raw === null || raw === undefined || raw === false) return null
    const asString = typeof raw === 'string' ? raw : JSON.stringify(raw)
    return parseCachedLatest(asString)
  } catch (err) {
    console.error('[prompt-cache] getCachedLatest failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function setCachedLatest(
  orgId: string,
  name: string,
  value: CachedLatest,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  try {
    await redis.eval(
      SET_IF_UNLOCKED,
      [latestKey(orgId, name), lockKey(orgId, name)],
      [JSON.stringify(value), String(VALUE_TTL_SECONDS)],
    )
  } catch (err) {
    console.error('[prompt-cache] setCachedLatest failed:', err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

/**
 * Invalidate every cache entry for a (org, name) pair. Takes a short write
 * lock so concurrent reads/writes during invalidation skip the cache.
 *
 * Call this from any mutation that could change resolution: create version,
 * delete version, start/stop A/B experiment, rollback.
 */
export async function invalidatePromptName(orgId: string, name: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  try {
    await redis.eval(
      INVALIDATE,
      [lockKey(orgId, name)],
      [
        String(LOCK_TTL_SECONDS),
        // nv prefix — we delete by SCAN MATCH `<prefix>*`
        `${KEY_PREFIX}nv:${orgId}:${name}:`,
        latestKey(orgId, name),
        String(SCAN_BATCH_SIZE),
      ],
    )
  } catch (err) {
    console.error('[prompt-cache] invalidatePromptName failed:', err instanceof Error ? err.message : err)
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (exported for tests)
// ---------------------------------------------------------------------------

function parseCachedLatest(raw: string): CachedLatest | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>

    if (obj.kind === 'single' && typeof obj.versionId === 'string') {
      return { kind: 'single', versionId: obj.versionId }
    }
    if (
      obj.kind === 'experiment' &&
      typeof obj.experimentId === 'string' &&
      typeof obj.versionAId === 'string' &&
      typeof obj.versionBId === 'string' &&
      typeof obj.trafficSplit === 'number'
    ) {
      return {
        kind: 'experiment',
        experimentId: obj.experimentId,
        versionAId: obj.versionAId,
        versionBId: obj.versionBId,
        trafficSplit: obj.trafficSplit,
      }
    }
    return null
  } catch {
    return null
  }
}

/** Test-only: reset the Redis singleton so tests can re-mock env vars. */
export function _resetRedisForTests(): void {
  _redis = null
}

/** Test-only: expose key builders for assertion. */
export const _internals = {
  uuidKey,
  nameVersionKey,
  latestKey,
  lockKey,
  namePattern,
  READ_IF_UNLOCKED,
  SET_IF_UNLOCKED,
  INVALIDATE,
  KEY_PREFIX,
  LOCK_TTL_SECONDS,
  VALUE_TTL_SECONDS,
  parseCachedLatest,
}
