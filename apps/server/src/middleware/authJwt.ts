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
// Reads and writes use an entry differently:
//   - Reads (GET/HEAD/OPTIONS) take all of it: identity, orgId and role.
//   - Writes (every other method) take only the verified identity (userId,
//     email) and re-resolve orgId and role from org_members on every request,
//     so every write handler acts on the caller's CURRENT workspace and role,
//     whether or not it has a role gate. Ungated writes are why this lives
//     here and not only in requireRole: shares POST mints a public link that
//     outlives the member, so a cached orgId there let a member removed a few
//     seconds earlier keep exposing the workspace's traces indefinitely.
//     The fresh result replaces the entry but keeps its original expiry, so a
//     stream of writes never stretches how long a verified token is trusted.
//
// Security trade-off:
//   - Revoked tokens stay valid until their cache entry expires (max 60s),
//     on reads and writes alike.
//   - Membership changes (admin demoted, user removed from org) can take up
//     to 60s to reach READ endpoints on an instance holding a warm entry.
//     Writes see them immediately (above). requireRole and
//     requireEditDualAuth read the role once more before a gated write, which
//     keeps those gates correct whichever middleware set `role` and makes a
//     failed lookup a 500 instead of a silent null.
//   - invalidateAuthCacheForUser() drops a user's entries on THIS instance
//     after a membership change, shortening the read-side staleness there.
//     Other serverless instances keep theirs until the TTL runs out; the
//     write-time re-resolution is what closes the window for writes.
interface AuthIdentity {
  userId: string
  email: string
}

interface Membership {
  orgId: string | null
  role: OrgRole | null
}

interface AuthCacheEntry extends AuthIdentity, Membership {
  expiresAt: number
}

const AUTH_CACHE_TTL_MS = 60_000
const AUTH_CACHE_MAX_SIZE = 1000

/** Methods that cannot change state. Everything else counts as a write. */
const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase())
}

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

function setCachedAuth(
  key: string,
  entry: Omit<AuthCacheEntry, 'expiresAt'>,
  expiresAt: number = Date.now() + AUTH_CACHE_TTL_MS,
): void {
  // Defensive size cap. JS Map iterates insertion order, so deleting the
  // first key approximates FIFO eviction. For a 60s TTL with the 1000-entry
  // cap we'd need >16 concurrent users/sec to ever hit this — current scale
  // is nowhere near. The cap exists to prevent unbounded growth if a bug
  // ever inflates the cache key space.
  if (_authCache.size >= AUTH_CACHE_MAX_SIZE) {
    const firstKey = _authCache.keys().next().value
    if (firstKey !== undefined) _authCache.delete(firstKey)
  }
  _authCache.set(key, { ...entry, expiresAt })
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
 * TTL expires. Write authorization does not depend on this helper (writes
 * always re-resolve the membership, see the cache notes above). Returns how
 * many entries were removed.
 */
export function invalidateAuthCacheForUser(userId: string): number {
  const staleKeys = [..._authCache.entries()]
    .filter(([, entry]) => entry.userId === userId)
    .map(([key]) => key)
  for (const key of staleKeys) _authCache.delete(key)
  return staleKeys.length
}

/** Verify the bearer token with Supabase Auth. Throws 401 when it is not valid. */
async function verifyToken(token: string): Promise<AuthIdentity> {
  const { data, error } = await supabaseClient.auth.getUser(token)

  if (error || !data.user) {
    throw new ApiError('UNAUTHORIZED', 'Invalid or expired token')
  }

  // Email comes from the same verified user record — no need for handlers to
  // re-fetch it via auth.admin.getUserById. Lowercased for case-insensitive
  // matching (Supabase stores emails case-insensitively).
  return { userId: data.user.id, email: (data.user.email ?? '').toLowerCase() }
}

/**
 * Workspace resolution order:
 *   1. `sb-ws` cookie — explicit user choice from the sidebar switcher.
 *      Validated against org_members so a stale cookie (e.g. after the
 *      user was removed from that org) silently falls through.
 *   2. Oldest org_members row — deterministic default for single-workspace
 *      users and for the very first request after signup before any cookie
 *      has been set.
 */
async function resolveMembership(
  userId: string,
  preferredOrgId: string | null,
): Promise<Membership> {
  if (preferredOrgId) {
    const { data: preferred } = await supabaseAdmin
      .from('org_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .eq('organization_id', preferredOrgId)
      .maybeSingle()
    if (preferred) {
      return { orgId: preferred.organization_id, role: preferred.role as OrgRole }
    }
  }

  const { data: membership } = await supabaseAdmin
    .from('org_members')
    .select('organization_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return {
    orgId: membership?.organization_id ?? null,
    role: (membership?.role as OrgRole | undefined) ?? null,
  }
}

/**
 * Store a freshly resolved membership under `key`.
 *
 * `previous` is the entry a write reused its identity from. Its expiry is
 * kept, and when the membership has moved since, every other entry of the
 * user on this instance (other tokens, other cookie variants) is dropped as
 * well. The pre-onboarding null is never stored (see the cache notes above).
 */
function rememberAuth(
  key: string,
  identity: AuthIdentity,
  membership: Membership,
  previous: AuthCacheEntry | null,
): void {
  const moved =
    previous !== null &&
    (previous.orgId !== membership.orgId || previous.role !== membership.role)
  if (moved) invalidateAuthCacheForUser(identity.userId)

  if (!membership.orgId) {
    _authCache.delete(key)
    return
  }
  setCachedAuth(key, { ...identity, ...membership }, previous?.expiresAt)
}

export const authJwt = createMiddleware<JwtContext>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    throw new ApiError('UNAUTHORIZED', 'Missing or invalid Authorization header')
  }

  const token = authHeader.slice(7)
  const preferredOrgId = readCookie(c.req.header('cookie'), WORKSPACE_COOKIE)
  const cacheK = authCacheKey(token, preferredOrgId)
  const cached = getCachedAuth(cacheK)

  // Fast path for reads: a cache hit skips both the Supabase Auth call and
  // the org_members query.
  if (cached && isReadMethod(c.req.method)) {
    c.set('userId', cached.userId)
    c.set('email', cached.email)
    c.set('orgId', cached.orgId)
    c.set('role', cached.role)
    return next()
  }

  // Writes reuse a cached identity but always re-resolve the membership.
  const identity: AuthIdentity = cached
    ? { userId: cached.userId, email: cached.email }
    : await verifyToken(token)
  const membership = await resolveMembership(identity.userId, preferredOrgId)
  rememberAuth(cacheK, identity, membership, cached)

  c.set('userId', identity.userId)
  c.set('email', identity.email)
  c.set('orgId', membership.orgId)
  c.set('role', membership.role)

  return next()
})
