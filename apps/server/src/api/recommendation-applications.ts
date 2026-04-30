import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * /api/v1/recommendation-applications — track applied cost-saving recommendations
 *
 *   GET    /              list all application records for the org
 *   POST   /              mark a recommendation as applied
 *   DELETE /:id           remove an application record (undo)
 *
 * Stored in `recommendation_applications`. One record per
 * (org, provider, model, suggestedProvider, suggestedModel) applied event.
 * Multiple records are allowed (idempotency not enforced — user may re-apply
 * after a rollback).
 */

export const recommendationApplicationsRouter = new Hono<JwtContext>()
recommendationApplicationsRouter.use('*', authJwt)

recommendationApplicationsRouter.get('/', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const { data, error } = await supabaseAdmin
    .from('recommendation_applications')
    .select('id, provider, model, suggested_provider, suggested_model, applied_at, note')
    .eq('organization_id', orgId)
    .order('applied_at', { ascending: false })

  if (error) return c.json({ error: 'Failed to fetch applications' }, 500)

  return c.json({
    success: true,
    data: (data ?? []).map((r: {
      id: string
      provider: string
      model: string
      suggested_provider: string
      suggested_model: string
      applied_at: string
      note: string | null
    }) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      suggestedProvider: r.suggested_provider,
      suggestedModel: r.suggested_model,
      appliedAt: r.applied_at,
      note: r.note ?? undefined,
    })),
  })
})

recommendationApplicationsRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  let body: {
    provider?: unknown
    model?: unknown
    suggestedProvider?: unknown
    suggestedModel?: unknown
    note?: unknown
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (
    typeof body.provider !== 'string' ||
    typeof body.model !== 'string' ||
    typeof body.suggestedProvider !== 'string' ||
    typeof body.suggestedModel !== 'string'
  ) {
    return c.json(
      { error: 'provider, model, suggestedProvider, suggestedModel are required' },
      400,
    )
  }

  const { data, error } = await supabaseAdmin
    .from('recommendation_applications')
    .insert({
      organization_id: orgId,
      user_id: userId,
      provider: body.provider,
      model: body.model,
      suggested_provider: body.suggestedProvider,
      suggested_model: body.suggestedModel,
      note: typeof body.note === 'string' ? body.note : null,
    })
    .select('id, applied_at')
    .single()

  if (error) return c.json({ error: 'Failed to mark as applied' }, 500)
  return c.json({ success: true, data: { id: (data as { id: string; applied_at: string }).id, appliedAt: (data as { id: string; applied_at: string }).applied_at } })
})

recommendationApplicationsRouter.delete('/:id', async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'Organization not found' }, 404)

  const id = c.req.param('id')

  const { error } = await supabaseAdmin
    .from('recommendation_applications')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return c.json({ error: 'Failed to remove application record' }, 500)
  return c.json({ success: true })
})
