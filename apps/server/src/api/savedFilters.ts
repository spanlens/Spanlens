import { Hono } from 'hono'
import { authJwt, type JwtContext } from '../middleware/authJwt.js'
import { supabaseAdmin } from '../lib/db.js'

/**
 * /api/v1/saved-filters — per-user named filter bookmarks.
 *
 *   GET    /         list this user's saved filters
 *   POST   /         create one  { name, filters: {…} }
 *   DELETE /:id      remove one
 *
 * Scoped to (user_id, organization_id). RLS on the table enforces user_id
 * isolation; the API additionally ties new rows to the current org.
 */

export const savedFiltersRouter = new Hono<JwtContext>()
savedFiltersRouter.use('*', authJwt)

interface SavedFilterRow {
  id: string
  name: string
  filters: Record<string, unknown>
  created_at: string
}

savedFiltersRouter.get('/', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Not authenticated' }, 401)

  const { data, error } = await supabaseAdmin
    .from('saved_filters')
    .select('id, name, filters, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .returns<SavedFilterRow[]>()

  if (error) return c.json({ error: 'Failed to fetch filters' }, 500)
  return c.json({ success: true, data: data ?? [] })
})

savedFiltersRouter.post('/', async (c) => {
  const userId = c.get('userId')
  const orgId = c.get('orgId')
  if (!userId || !orgId) return c.json({ error: 'Not authenticated' }, 401)

  let body: { name?: unknown; filters?: unknown }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 80) {
    return c.json({ error: 'name must be 1–80 characters' }, 400)
  }
  const filters = typeof body.filters === 'object' && body.filters !== null ? body.filters : {}

  const { data, error } = await supabaseAdmin
    .from('saved_filters')
    .insert({ user_id: userId, organization_id: orgId, name, filters })
    .select('id, name, filters, created_at')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return c.json({ error: 'A filter with this name already exists' }, 409)
    }
    return c.json({ error: 'Failed to save filter' }, 500)
  }
  return c.json({ success: true, data }, 201)
})

savedFiltersRouter.delete('/:id', async (c) => {
  const userId = c.get('userId')
  if (!userId) return c.json({ error: 'Not authenticated' }, 401)

  const id = c.req.param('id')
  const { error } = await supabaseAdmin
    .from('saved_filters')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) return c.json({ error: 'Failed to delete' }, 500)
  return c.json({ success: true })
})
