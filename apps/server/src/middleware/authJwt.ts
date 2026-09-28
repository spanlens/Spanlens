import { createMiddleware } from 'hono/factory'
import { supabaseAdmin, supabaseClient } from '../lib/db.js'
import { ApiError } from '../lib/errors.js'

export type OrgRole = 'admin' | 'editor' | 'viewer'

export type JwtContext = {
  Variables: {
    userId: string
    /**
     * The signed-in user's email, lowercased. Populated from the JWT user
     * record so handlers don't have to make a second `auth.admin.getUserById`
     * roundtrip just to get it — that pattern previously cost 1.5~3s per
     * dashboard request. Always present when authJwt runs.
     */
    email: string
    /**
     * Organization id resolved from the user's org_members row.
     * `null` means the user has not joined any org yet (pre-onboarding).
     * Routes that require an org should guard with:
     *   if (!orgId) throw new ApiError('NOT_FOUND', 'Organization not found')
     */
    orgId: string | null
    /**
     * The user's role within `orgId`. `null` when orgId is null.
     * Use `requireRole(...)` middleware to gate write endpoints.
     */
    role: OrgRole | null
  }
}

/** Plain cookie reader — avoids pulling a library for one lookup. */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.split('=')
    if (rawName?.trim() === name) return decodeURIComponent(rest.join('=').trim())
  }
  return null
}

export const WORKSPACE_COOKIE = 'sb-ws'

// ── In-memory auth cache ─────────────────────────────────────────
//
// Why: a single /dashboard load fires ~9 concurrent /api/v1/* requests.
// Without caching, each one repeats two slow lookups in this middleware:
//   1. supabaseClient.auth.getUser(token) — Supabase Auth REST roundtrip
//      (~100-500ms warm, more on cold start)
//   2. org_members SELECT to resolve workspace + role (~50-200ms)
// That's 1-4s of pure middleware overhead per dashboard load.
//
// With caching: the first request pays the full cost, the next eight find
// the entry and return in <1ms. Cache is per-Lambda-instance (a Map),
// keyed by (token, preferredOrgId), with a 60s TTL.
//
// Only RESOLVED memberships are cached. A "no membership yet" result
// (orgId=null, the pre-onboarding state) is never stored: bootstrap's own
// authJwt pass runs before it INSERTs the membership row, so caching that
// null made /organizations/me answer 404 for up to 60s right after signup.
// Pre-onboarding traffic is a handful of requests per user, so paying the
// lookup on each of them costs nothing noticeable.
//
// Security trade-off:
//   - Revoked tokens stay valid until their cache entry expires (max 60s).
//   - Role changes (admin demoted, user removed from org) can take up to 60s
//     to surface on READ endpoints. WRITE endpoints do not trust the cached
//     role: requireRole and requireEditDualAuth re-read org_members for every
//     request that is not GET/HEAD/OPTIONS, so a demoted or removed member is
//     rejected immediately. Trusting the cached role there was not harmless:
//     inside the window a demoted admin could re-promote themselves (or a
//     removed one could invite themselves back) and keep admin for good.
//   - invalidateAuthCacheForUser() drops a user's entries on THIS instance
//     after a membership change. Other serverless instances keep theirs until
//     the TTL runs out, which is why the write-time re-check above is the
//     actual guarantee and the helper only shortens the read-side staleness.
interface AuthCacheEntry {
  userId: string
  email: string
  orgId: string | null
  role: OrgRole | null
  expiresAt: number
}

const AUTH_CACHE_TTL_MS = 60_000
const AUTH_CACHE_MAX_SIZE = 1000

const _authCache = new Map<string, AuthCacheEntry>()

function authCacheKey(token: string, preferredOrgId: string | null): string {
  return preferredOrgId ? `${token}::${preferredOrgId}` : token
}

function getCachedAuth(key: string): AuthCacheEntry | null {
  const entry = _authCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    _authCache.delete(key)
    return null
  }
  return entry
}

function setCachedAuth(key: string, entry: Omit<AuthCacheEntry, 'expiresAt'>): void {
  // Defensive size cap. JS Map iterates insertion order, so deleting the
  // first key approximates FIFO eviction. For a 60s TTL with the 1000-entry
  // cap we'd need >16 concurrent users/sec to ever hit this — current scale
  // is nowhere near. The cap exists to prevent unbounded growth if a bug
  // ever inflates the cache key space.
  if (_authCache.size >= AUTH_CACHE_MAX_SIZE) {
    const firstKey = _authCache.keys().next().value
    if (firstKey !== undefined) _authCache.delete(firstKey)
  }
  _authCache.set(key, { ...entry, expiresAt: Date.now() + AUTH_CACHE_TTL_MS })
}

/** Test-only: clear the cache between unit tests. */
export function _clearAuthCacheForTests(): void {
  _authCache.clear()
}

/**
 * Drop every cached entry for `userId` on this instance (every token and
 * every workspace-cookie variant). Call it right after changing that user's
 * membership (bootstrap, role change, removal) so their next request on this
 * instance re-resolves orgId and role from org_members.
 *
 * Process-local only: other serverless instances keep their entries until the
 * TTL expires. Write authorization does not depend on this helper (see the
 * write-time re-check in requireRole). Returns how many entries were removed.
 */
export function invalidateAuthCacheForUser(userId: string): number {
  const staleKeys = [..._authCache.entries()]
    .filter(([, entry]) => entry.userId === userId)
    .map(([key]) => key)
  for (const key of staleKeys) _authCache.delete(key)
  return staleKeys.length
}

export const authJwt = createMiddleware<JwtContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw new ApiError('UNAUTHORIZED', 'Missing or invalid Authorization header')
  }

  const token = authHeader.slice(7)
  const preferredOrgId = readCookie(c.req.header('cookie'), WORKSPACE_COOKIE)
  const cacheK = authCacheKey(token, preferredOrgId)

  // Fast path: cache hit. Skips both the Supabase Auth call and the
  // org_members query.
  const cached = getCachedAuth(cacheK)
  if (cached) {
    c.set('userId', cached.userId)
    c.set('email', cached.email)
    c.set('orgId', cached.orgId)
    c.set('role', cached.role)
    return next()
  }

  const { data, error } = await supabaseClient.auth.getUser(token)

  if (error || !data.user) {
    throw new ApiError('UNAUTHORIZED', 'Invalid or expired token')
  }

  const userId = data.user.id
  // Email comes from the same verified user record — no need for handlers to
  // re-fetch it via auth.admin.getUserById. Lowercased for case-insensitive
  // matching (Supabase stores emails case-insensitively).
  const email = (data.user.email ?? '').toLowerCase()

  // Workspace resolution order:
  //   1. `sb-ws` cookie — explicit user choice from the sidebar switcher.
  //      Validated against org_members so a stale cookie (e.g. after the
  //      user was removed from that org) silently falls through.
  //   2. Oldest org_members row — deterministic default for single-workspace
  //      users and for the very first request after signup before any cookie
  //      has been set.
  let orgId: string | null = null
  let role: OrgRole | null = null

  if (preferredOrgId) {
    const { data: preferred } = await supabaseAdmin
      .from('org_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .eq('organization_id', preferredOrgId)
      .maybeSingle()
    if (preferred) {
      orgId = preferred.organization_id
      role = preferred.role as OrgRole
    }
  }

  if (!orgId) {
    const { data: membership } = await supabaseAdmin
      .from('org_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    orgId = membership?.organization_id ?? null
    role = (membership?.role as OrgRole | undefined) ?? null
  }

  // Never cache the pre-onboarding "no membership" result (see the cache
  // notes above): the membership may be created by the very request that is
  // running right now (bootstrap), and a cached null would hide it for 60s.
  if (orgId) setCachedAuth(cacheK, { userId, email, orgId, role })

  c.set('userId', userId)
  c.set('email', email)
  c.set('orgId', orgId)
  c.set('role', role)

  return next()
})
