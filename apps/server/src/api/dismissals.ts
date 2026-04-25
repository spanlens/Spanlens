import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * /api/v1/dismissals — per-user dismiss state for the dashboard's
 * "Needs attention" cards.
 *
 *   GET    /              list the current user's dismissed card keys
 *   POST   /              body: { cardKey } — dismiss one
 *   DELETE /:cardKey      restore (un-dismiss)
 *
 * Stored in `attn_dismissals` (Phase 1). Keyed by (org_id, user_id, card_key)
 * so two users in the same org can have independent dismiss state.
 *
 * cardKey format is caller-defined but should be deterministic so the same
 * underlying signal (e.g. "anomaly on gpt-4o-mini latency") produces the
 * same key and stays dismissed across re-renders. Examples:
 *   - pii_leak
 *   - anomaly:{provider}:{model}:{kind}
 *   - alert:{alertId}
 *   - savings:{recommendationId}
 */

export const dismissalsRouter = new Hono<JwtContext>()
dismissalsRouter.use('*', authJwt)

dismissalsRouter.get('/', async (c) => {
  const userId = c.get('userId')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('attn_dismissals')
    .select('card_key')
    .eq('organization_id', orgId)
    .eq('user_id', userId)

  if (error) return c.json({ error: 'Failed to fetch dismissals' }, 500)
  return c.json({ success: true, data: (data ?? []).map((r) => r.card_key) })
})

dismissalsRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: { cardKey?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (typeof body.cardKey !== 'string' || body.cardKey.trim().length === 0) {
    return c.json({ error: 'cardKey is required' }, 400)
  }
  // Clamp length — the table has no explicit limit but we don't want users
  // writing runaway strings. 256 is plenty for our naming scheme.
  if (body.cardKey.length > 256) {
    return c.json({ error: 'cardKey too long' }, 400)
  }

  const { error } = await supabaseAdmin
    .from('attn_dismissals')
    .upsert(
      { organization_id: orgId, user_id: userId, card_key: body.cardKey },
      { onConflict: 'organization_id,user_id,card_key', ignoreDuplicates: true },
    )

  if (error) return c.json({ error: 'Failed to dismiss' }, 500)
  return c.json({ success: true })
})

dismissalsRouter.delete('/:cardKey', async (c) => {
  const userId = c.get('userId')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const cardKey = c.req.param('cardKey')

  const { error } = await supabaseAdmin
    .from('attn_dismissals')
    .delete()
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('card_key', cardKey)

  if (error) return c.json({ error: 'Failed to restore' }, 500)
  return c.json({ success: true })
})
