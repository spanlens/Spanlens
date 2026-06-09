import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { supabaseAdmin } from '../lib/db.js'
import { sha256Hex } from '../lib/crypto.js'
import { maybeStampLastUsed } from '../lib/api-key-last-used.js'
import { fireAndForget } from '../lib/wait-until.js'
import { ApiError } from '../lib/errors.js'
import type { Plan } from '../lib/quota.js'

/**
 * Validates a Spanlens API key (sl_live_* or sl_live_pub_*) against `api_keys`.
 *
 * Each provider SDK uses a different transport for the key, so this
 * middleware accepts whichever shape the SDK sends — the proxy is
 * provider-agnostic at the auth layer:
 *
 *   • OpenAI SDK            → Authorization: Bearer sl_live_…
 *   • Anthropic SDK         → x-api-key: sl_live_…
 *   • Google Generative AI  → x-goog-api-key: sl_live_…
 *
 * The first one found wins. After validation we put apiKeyId, scope, and
 * organizationId on the context. `projectId` is set ONLY for `full` keys —
 * `public` keys are workspace-scoped and have no single owning project.
 *
 * Note: ?key= query-string transport was removed (security: keys leak into
 * server access logs, browser history, and Referer headers). All current
 * Google Generative AI SDK versions use the x-goog-api-key header.
 */
export type ApiKeyScope = 'full' | 'public'

export type ApiKeyContext = {
  Variables: {
    organizationId: string
    /** Always present for `full` scope; null for `public` (workspace-level) keys. */
    projectId: string | null
    apiKeyId: string
    apiKeyScope: ApiKeyScope
    // R-4/R-5: the owning org's plan is hoisted onto the context so the
    // downstream rateLimit middleware can pick a tier limit without a
    // second `organizations.plan` SELECT. Cached together with the auth
    // lookup result; invalidated by lib helpers when a key is
    // deactivated or its scope changes.
    plan: Plan
  }
}

// ── R-4/R-5: API-key lookup cache (in-memory, per-instance) ──────────────
//
// authApiKey() runs once per proxy request and used to hit
// `api_keys` + `projects` + `organizations` on every single call. The
// raw lookup is cheap (<10ms p50 against Supabase) but the volume
// dominates — proxy traffic is the hottest path we have. A tiny
// in-memory cache keyed by sha256(rawKey) collapses identical-key
// repeats to a Map lookup.
//
// Choices the comments unpack:
//
//   - Map + FIFO eviction is not a true LRU (insertion-order eviction
//     drops oldest entries first regardless of access). At our cap
//     (1000 entries) the difference between FIFO and proper LRU is
//     invisible — the working set fits comfortably. If we ever need
//     stricter LRU we'd swap to a doubly-linked list, but not yet.
//
//   - Differentiated TTLs: scope=full carries 30s, scope=public
//     carries 60s. Public keys are mass-distributed (one key in many
//     read-only dashboards) so a slightly longer TTL is fine — they
//     can't write, the worst that happens is a deactivated key keeps
//     working for an extra 30s. Full keys are smaller-fanout but
//     trigger more dangerous behaviour (proxy spend, ingest writes),
//     so we keep their TTL shorter.
//
//   - The cache is process-local. Vercel's serverless instances are
//     ephemeral; we lose the cache between cold starts, which is the
//     intended behaviour. A shared Redis cache would buy more hit-rate
//     but also adds another failure mode on the hottest path.
//
//   - Invalidation is explicit. The only mutation we care about is
//     "the key was deactivated" (DELETE in apiKeys.ts). Other mutations
//     (rotating last_used_at, etc.) don't affect the cached fields.
//     The exported invalidateApiKeyCache lets the DELETE handler clear
//     the entry the instant the request returns, so the in-flight
//     30s TTL window can't shadow the soft-delete.

interface CachedApiKeyResult {
  organizationId: string
  projectId: string | null
  apiKeyId: string
  apiKeyScope: ApiKeyScope
  plan: Plan
}

const apiKeyCache = new Map<string, { value: CachedApiKeyResult; expiresAt: number }>()
const CACHE_TTL_FULL_MS = 30_000   // 30s for sl_live_*
const CACHE_TTL_PUBLIC_MS = 60_000 // 60s for sl_live_pub_*
const CACHE_MAX_ENTRIES = 1000

function getCachedApiKey(keyHash: string): CachedApiKeyResult | null {
  const entry = apiKeyCache.get(keyHash)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    apiKeyCache.delete(keyHash)
    return null
  }
  return entry.value
}

function setCachedApiKey(keyHash: string, value: CachedApiKeyResult): void {
  if (apiKeyCache.size >= CACHE_MAX_ENTRIES) {
    // FIFO eviction — Map iteration order is insertion order, so the
    // first key is the oldest. Good enough at this cap (see above).
    const firstKey = apiKeyCache.keys().next().value
    if (firstKey) apiKeyCache.delete(firstKey)
  }
  const ttl = value.apiKeyScope === 'public' ? CACHE_TTL_PUBLIC_MS : CACHE_TTL_FULL_MS
  apiKeyCache.set(keyHash, { value, expiresAt: Date.now() + ttl })
}

/**
 * Invalidate one API-key cache entry. Call this whenever the row's
 * `is_active`, `scope`, or owning org changes — the cached snapshot
 * cannot reflect that mutation otherwise, and the worst case (a
 * deactivated `sl_live_*` continuing to authenticate proxy traffic
 * for 30s) is the kind of incident we explicitly designed the cache
 * to avoid.
 *
 * Takes the sha256 `key_hash` (stored in api_keys), not the raw
 * `sl_live_*` value — the DELETE handler in apiKeys.ts only has the
 * hashed form and we never want to round-trip through the raw key.
 *
 * Exported as part of the public middleware API so apiKeys.ts can
 * invalidate during DELETE without reaching into module internals.
 */
export function invalidateApiKeyCache(keyHash: string): void {
  apiKeyCache.delete(keyHash)
}

/** Test-only helper. Production never calls this. */
export function _clearApiKeyCacheForTests(): void {
  apiKeyCache.clear()
}

/** Pull the Spanlens key out of the request, regardless of which SDK sent it. */
function extractApiKey(c: Context): string | null {
  // 1. OpenAI / generic Bearer auth
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.slice(7).trim()
    if (key) return key
  }

  // 2. Anthropic SDK
  const xApiKey = c.req.header('x-api-key')
  if (xApiKey?.trim()) return xApiKey.trim()

  // 3. Google Generative AI SDK (current versions) — header form.
  //    Verified against @google/generative-ai dist source: requests carry
  //    `x-goog-api-key: <apiKey>` (and `x-goog-api-client` for telemetry).
  const xGoogKey = c.req.header('x-goog-api-key')
  if (xGoogKey?.trim()) return xGoogKey.trim()

  return null
}

export const authApiKey = createMiddleware<ApiKeyContext>(async (c, next) => {
  const rawKey = extractApiKey(c)
  if (!rawKey) {
    return c.json(
      {
        error:
          'Missing API key. Pass sl_live_… via Authorization: Bearer (OpenAI SDK), x-api-key (Anthropic SDK), or x-goog-api-key (Google Generative AI SDK).',
      },
      401,
    )
  }

  const keyHash = await sha256Hex(rawKey)

  // R-4: cache fast path. Hit here means we already resolved this key
  // (organizationId + scope + plan) within the TTL window — set the
  // four context vars and skip the Supabase round-trip entirely.
  // last_used_at refresh still fires (throttled inside the helper) so
  // dashboards see traffic even when every request is a cache hit.
  const cached = getCachedApiKey(keyHash)
  if (cached) {
    c.set('apiKeyId', cached.apiKeyId)
    c.set('apiKeyScope', cached.apiKeyScope)
    c.set('organizationId', cached.organizationId)
    c.set('projectId', cached.projectId)
    c.set('plan', cached.plan)
    fireAndForget(c, maybeStampLastUsed(cached.apiKeyId))
    return next()
  }

  // R-5: pulling `organizations(plan)` along the existing join chain
  // removes the second SELECT that rateLimit used to do. The CHECK
  // constraint in the migration guarantees exactly one of
  // (project_id, organization_id) is non-null, so the join shape
  // differs by scope:
  //   full   → api_keys → projects(organization_id, organizations(plan))
  //   public → api_keys → organizations(plan)
  // We ask for both branches in one SELECT and reconcile in code,
  // which is cheaper than running scope-specific queries.
  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select(
      'id, project_id, organization_id, scope, projects(organization_id, organizations(plan)), organizations(plan)',
    )
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    // Sprint 7 R-15: standard envelope. Don't leak whether the key was
    // unknown vs. inactive vs. revoked — UNAUTHORIZED covers all three
    // with one indistinguishable response (defence against token probing).
    throw new ApiError('UNAUTHORIZED', 'Invalid API key')
  }

  const scope: ApiKeyScope = (data.scope as string) === 'public' ? 'public' : 'full'

  // Resolve organizationId + plan based on scope. PostgREST embeds the
  // joined row as a nested object (or null if no FK match).
  let organizationId: string | null = null
  let plan: Plan = 'free'
  if (scope === 'full') {
    const project = data.projects as unknown as {
      organization_id: string
      organizations: { plan: string | null } | null
    } | null
    organizationId = project?.organization_id ?? null
    plan = ((project?.organizations?.plan as Plan | null) ?? 'free') as Plan
  } else {
    organizationId = (data.organization_id as string | null) ?? null
    const org = data.organizations as unknown as { plan: string | null } | null
    plan = ((org?.plan as Plan | null) ?? 'free') as Plan
  }

  if (!organizationId) {
    // The api_keys row should always carry either project_id (full scope)
    // or organization_id (public scope) per the DB CHECK constraint. A
    // missing org here means the data integrity contract was violated;
    // INTERNAL_ERROR with a hint via details for the operator log path.
    throw ApiError.from('INTERNAL_ERROR', {
      reason: 'api_keys row has no resolvable organization',
      apiKeyId: data.id as string,
    })
  }

  const apiKeyId = data.id as string
  const projectId = (data.project_id as string | null) ?? null

  c.set('apiKeyId', apiKeyId)
  c.set('apiKeyScope', scope)
  c.set('organizationId', organizationId)
  c.set('projectId', projectId)
  c.set('plan', plan)

  // Populate the cache for the next request hitting this key. We do
  // this after setting context so a parse error above (which shouldn't
  // happen but we're defensive) doesn't pollute the cache with a
  // half-resolved entry.
  setCachedApiKey(keyHash, {
    organizationId,
    projectId,
    apiKeyId,
    apiKeyScope: scope,
    plan,
  })

  // Refresh `last_used_at` so the dashboard can surface stale keys.
  // Fire-and-forget: a slow write must never block the proxy hot path.
  // Throttled in-memory to ~1 UPDATE per key per 5 min — see api-key-last-used.ts.
  fireAndForget(c, maybeStampLastUsed(apiKeyId))

  return next()
})
