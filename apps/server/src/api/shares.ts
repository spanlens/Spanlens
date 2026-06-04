import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'
import { randomHex } from '../lib/crypto.js'
import { requestsScope, selectRequests } from '../lib/requests-query.js'

/**
 * /api/v1/shares — owner-side CRUD for public share tokens (PLG Loop ①).
 *
 * Public viewing of a token happens at `/share/:token` (see app.ts) — that
 * route is intentionally outside this router so it bypasses authJwt.
 */
export const sharesRouter = new Hono<JwtContext>()

sharesRouter.use('*', authJwt)

type Scope = 'trace' | 'request'

interface CreateShareBody {
  scope?: unknown
  targetId?: unknown
  ttl?: unknown          // '7d' | '30d' | 'never'
  redactPii?: unknown
  redactCost?: unknown
  redactTokens?: unknown
  indexable?: unknown
}

function isScope(value: unknown): value is Scope {
  return value === 'trace' || value === 'request'
}

function ttlToExpiresAt(ttl: unknown): string | null {
  if (ttl === 'never') return null
  const days = ttl === '7d' ? 7 : 30 // default: 30d
  const ms = days * 24 * 60 * 60 * 1000
  return new Date(Date.now() + ms).toISOString()
}

/**
 * Verifies the caller owns the target before issuing a share token. Without
 * this a user could mint a public link for any UUID they guess, since the
 * public viewer endpoint runs without auth.
 */
async function targetExists(
  scope: Scope,
  targetId: string,
  orgId: string,
): Promise<boolean> {
  if (scope === 'trace') {
    const { data } = await supabaseAdmin
      .from('traces')
      .select('id')
      .eq('id', targetId)
      .eq('organization_id', orgId)
      .maybeSingle()
    return !!data
  }
  // scope === 'request' — ClickHouse. Use ignoreRetention so an owner can still
  // share a request near the retention boundary.
  try {
    const requestScope = await requestsScope(orgId, { ignoreRetention: true })
    const rows = await selectRequests<{ id: string }>({
      scope: requestScope,
      select: 'id',
      filters: 'id = {requestId:UUID}',
      params: { requestId: targetId },
      limit: 1,
    })
    return rows.length > 0
  } catch {
    return false
  }
}

// POST /api/v1/shares — create a new share token.
sharesRouter.post('/', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: CreateShareBody
  try {
    body = (await c.req.json()) as CreateShareBody
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!isScope(body.scope)) {
    return c.json({ error: "scope must be 'trace' or 'request'" }, 400)
  }
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : ''
  if (!targetId) return c.json({ error: 'targetId is required' }, 400)

  const ok = await targetExists(body.scope, targetId, orgId)
  if (!ok) return c.json({ error: 'Target not found' }, 404)

  const token = randomHex(16) // 32 hex chars → ~128 bits
  const expiresAt = ttlToExpiresAt(body.ttl)

  const insert = {
    token,
    scope: body.scope,
    target_id: targetId,
    organization_id: orgId,
    created_by: userId,
    redact_pii: body.redactPii === false ? false : true,
    redact_cost: body.redactCost === false ? false : true,
    redact_tokens: body.redactTokens === true,
    indexable: body.indexable === true,
    expires_at: expiresAt,
  }

  const { data, error } = await supabaseAdmin
    .from('shared_links')
    .insert(insert)
    .select('id, token, scope, target_id, expires_at, redact_pii, redact_cost, redact_tokens, indexable, view_count, created_at')
    .single()

  if (error || !data) {
    console.error('[shares:create] insert failed:', error?.message)
    return c.json({ error: 'Failed to create share' }, 500)
  }

  return c.json({ success: true, data })
})

// GET /api/v1/shares — list active shares the caller created in this org.
sharesRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('shared_links')
    .select('id, token, scope, target_id, expires_at, redact_pii, redact_cost, redact_tokens, indexable, view_count, revoked_at, created_at')
    .eq('organization_id', orgId)
    .eq('created_by', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('[shares:list] select failed:', error.message)
    return c.json({ error: 'Failed to list shares' }, 500)
  }
  return c.json({ success: true, data: data ?? [] })
})

// DELETE /api/v1/shares/:token — revoke a share (soft delete).
sharesRouter.delete('/:token', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)
  const token = c.req.param('token')

  // Org-scoped: any member of the org can revoke any share in their org.
  // (The dashboard surfaces only the caller's own shares, but admins should
  // be able to revoke a teammate's leaked share without a separate admin UI.)
  const { error, count } = await supabaseAdmin
    .from('shared_links')
    .update({ revoked_at: new Date().toISOString() }, { count: 'exact' })
    .eq('token', token)
    .eq('organization_id', orgId)
    .is('revoked_at', null)

  if (error) {
    console.error('[shares:revoke] update failed:', error.message)
    return c.json({ error: 'Failed to revoke share' }, 500)
  }
  if (!count) return c.json({ error: 'Share not found' }, 404)

  return c.json({ success: true })
})
